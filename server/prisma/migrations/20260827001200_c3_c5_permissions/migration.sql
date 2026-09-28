-- ===========================================================================
--  C3 / C5 - THE PERMISSIONS THE TWO NEW GATES NEED
-- ===========================================================================
--
--  Two documents became approvable and one is entirely new, so three things
--  need saying in the RBAC tables:
--
--    DYE_ISSUE.APPROVE        C3 - a job work order is now [A][S]. Somebody
--                             has to authorise sending several lakh rupees of
--                             the company's own cloth into another firm's
--                             building, and it may not be the person who
--                             raised the order.
--
--    CUTTING_CHALLAN.*        C5 - a whole new document.
--
--  ---------------------------------------------------------------------------
--   WHO GETS THEM, AND WHY IT IS DERIVED RATHER THAN LISTED
--
--   Rule 8 of the brief: do not hardcode approvers. So no role is named in
--   this migration. Each new permission is granted to exactly the roles that
--   ALREADY hold the closest existing equivalent:
--
--     DYE_ISSUE.APPROVE        -> whoever holds PURCHASE_ORDER.APPROVE, because
--                                 a job work order IS a purchase - the company
--                                 is buying dyeing.
--     CUTTING_CHALLAN.VIEW     -> whoever holds CUTTING_ISSUE.VIEW
--     CUTTING_CHALLAN.CREATE   -> whoever holds CUTTING_ISSUE.CREATE
--     CUTTING_CHALLAN.EDIT     -> whoever holds CUTTING_ISSUE.EDIT
--     CUTTING_CHALLAN.DELETE   -> whoever holds CUTTING_ISSUE.DELETE
--     CUTTING_CHALLAN.APPROVE  -> whoever holds PLAN_APPROVAL.APPROVE, because
--                                 the challan is drawn against an approved
--                                 plan and the same office signs both.
--
--   That means the office's existing decisions about who does what carry
--   forward automatically, and nothing here asserts a new one. If the wrong
--   people end up with a permission, the fix is on the Roles screen, which is
--   where such a decision belongs.
--
--   MAKER-CHECKER IS SEPARATE AND IS NOT A PERMISSION. Holding
--   CUTTING_CHALLAN.APPROVE does not let you approve YOUR OWN challan -
--   domain/makerChecker.js refuses that regardless of role, because it is a
--   different control from "may this person approve challans at all".
-- ===========================================================================

INSERT INTO "permissions" ("id", "code", "module", "action", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), v.code, v.module, v.action, v.description, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM (VALUES
    ('DYE_ISSUE.APPROVE', 'DYE_ISSUE', 'APPROVE',
     'C3: authorise a job work order before any fabric is issued against it.'),
    ('CUTTING_CHALLAN.VIEW', 'CUTTING_CHALLAN', 'VIEW',
     'C5: see the cutting department''s raised requirements.'),
    ('CUTTING_CHALLAN.CREATE', 'CUTTING_CHALLAN', 'CREATE',
     'C5: raise a cutting requirement against an approved planning version.'),
    ('CUTTING_CHALLAN.EDIT', 'CUTTING_CHALLAN', 'EDIT',
     'C5: amend a cutting challan while it is still a draft.'),
    ('CUTTING_CHALLAN.DELETE', 'CUTTING_CHALLAN', 'DELETE',
     'C5: delete a draft cutting challan.'),
    ('CUTTING_CHALLAN.APPROVE', 'CUTTING_CHALLAN', 'APPROVE',
     'C5: authorise a cutting challan, and close one short. Fabric may only be issued against an approved challan.')
  ) AS v(code, module, action, description)
 WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."code" = v.code);

-- Grant each new permission to the roles already holding its nearest existing
-- equivalent. No role is named; the office's own decisions carry forward.
INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT rp."role_id", np."id", CURRENT_TIMESTAMP
  FROM (VALUES
    ('DYE_ISSUE.APPROVE',       'PURCHASE_ORDER.APPROVE'),
    ('CUTTING_CHALLAN.VIEW',    'CUTTING_ISSUE.VIEW'),
    ('CUTTING_CHALLAN.CREATE',  'CUTTING_ISSUE.CREATE'),
    ('CUTTING_CHALLAN.EDIT',    'CUTTING_ISSUE.EDIT'),
    ('CUTTING_CHALLAN.DELETE',  'CUTTING_ISSUE.DELETE'),
    ('CUTTING_CHALLAN.APPROVE', 'PLAN_APPROVAL.APPROVE')
  ) AS m(new_code, like_code)
  JOIN "permissions" np ON np."code" = m.new_code
  JOIN "permissions" lp ON lp."code" = m.like_code
  JOIN "role_permissions" rp ON rp."permission_id" = lp."id"
 WHERE NOT EXISTS (
   SELECT 1 FROM "role_permissions" x
    WHERE x."role_id" = rp."role_id" AND x."permission_id" = np."id"
 );
