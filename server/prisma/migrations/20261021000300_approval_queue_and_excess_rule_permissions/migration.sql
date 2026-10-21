-- ===========================================================================
--  APPROVAL_QUEUE AND EXCESS_RULE - two screens get permissions of their own
-- ===========================================================================
--
--  Dashboard > Approvals (GET /workflow/queue) was guarded by REPORT.VIEW, and
--  Masters > Excess Rules (/excess/rules) by MASTER_LIST.*. Both put a screen
--  in front of desks the business does not want there:
--
--    APPROVAL_QUEUE.VIEW   everyone who had the queue EXCEPT QC and the three
--                          finishing desks (Ironing & Finishing, External QC,
--                          Alteration). Granted to every role that holds
--                          REPORT.VIEW today minus those four, so a role made
--                          in the Roles screen keeps what it had.
--    EXCESS_RULE.*         the Store & Cutting Manager maintains the rules
--                          (view, create, edit, export - no delete), the
--                          Director reads them, ADMIN holds everything.
--                          Head Office, Merchandising, QC and the floor desks
--                          lose the screen; they keep MASTER_LIST.* as before.
--
--  Vendor Performance needs no row: its guard simply stops accepting
--  REPORT.VIEW (client only - see navigation.js).
--
--  Inserts only, and idempotent. Mirrors seed/data/rbac.js.
-- ===========================================================================

INSERT INTO "permissions" ("id", "code", "module", "action", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), v.code, v.module, v.action, v.description, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM (VALUES
    ('APPROVAL_QUEUE.VIEW',   'APPROVAL_QUEUE', 'VIEW',   'View approval queue'),
    ('APPROVAL_QUEUE.EXPORT', 'APPROVAL_QUEUE', 'EXPORT', 'Export approval queue'),
    ('EXCESS_RULE.VIEW',      'EXCESS_RULE',    'VIEW',   'View excess rule'),
    ('EXCESS_RULE.CREATE',    'EXCESS_RULE',    'CREATE', 'Create excess rule'),
    ('EXCESS_RULE.EDIT',      'EXCESS_RULE',    'EDIT',   'Edit excess rule'),
    ('EXCESS_RULE.DELETE',    'EXCESS_RULE',    'DELETE', 'Delete excess rule'),
    ('EXCESS_RULE.EXPORT',    'EXCESS_RULE',    'EXPORT', 'Export excess rule')
  ) AS v(code, module, action, description)
 WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."code" = v.code);

-- The queue: whoever could open it through REPORT.VIEW, less the four desks.
INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT rp."role_id", q."id", CURRENT_TIMESTAMP
  FROM "role_permissions" rp
  JOIN "permissions" rv ON rv."id" = rp."permission_id" AND rv."code" = 'REPORT.VIEW'
  JOIN "roles" r ON r."id" = rp."role_id"
  JOIN "permissions" q ON q."code" = 'APPROVAL_QUEUE.VIEW'
 WHERE r."code" NOT IN ('QC', 'FINISHING_SUPERVISOR', 'EXTERNAL_QC_COORDINATOR', 'ALTERATION_SUPERVISOR')
    ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- Fixed grants, by role.
INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT r."id", p."id", CURRENT_TIMESTAMP
  FROM (VALUES
    ('ADMIN',         'APPROVAL_QUEUE.VIEW'),
    ('ADMIN',         'APPROVAL_QUEUE.EXPORT'),
    ('ADMIN',         'EXCESS_RULE.VIEW'),
    ('ADMIN',         'EXCESS_RULE.CREATE'),
    ('ADMIN',         'EXCESS_RULE.EDIT'),
    ('ADMIN',         'EXCESS_RULE.DELETE'),
    ('ADMIN',         'EXCESS_RULE.EXPORT'),
    ('DIRECTOR',      'APPROVAL_QUEUE.VIEW'),
    ('DIRECTOR',      'APPROVAL_QUEUE.EXPORT'),
    ('DIRECTOR',      'EXCESS_RULE.VIEW'),
    ('DIRECTOR',      'EXCESS_RULE.EXPORT'),
    ('STORE_MANAGER', 'EXCESS_RULE.VIEW'),
    ('STORE_MANAGER', 'EXCESS_RULE.CREATE'),
    ('STORE_MANAGER', 'EXCESS_RULE.EDIT'),
    ('STORE_MANAGER', 'EXCESS_RULE.EXPORT')
  ) AS g(role_code, permission_code)
  JOIN "roles" r ON r."code" = g.role_code
  JOIN "permissions" p ON p."code" = g.permission_code
    ON CONFLICT ("role_id", "permission_id") DO NOTHING;
