-- ===========================================================================
--  PLANNING AND THE PLANNING GM ARE ONE DESK
-- ===========================================================================
--
--  The third role merge in this system, and the same reasoning as the first
--  two: the GM who owns planning end to end and the desk that prepares the
--  plans are the same person, and two logins for one person is a fiction the
--  system should not carry.
--
--  MERCHANDISING survives and absorbs PLANNING_GM, matching how
--  PLANNING_OPERATOR and CUTTING_SUPERVISOR were merged away before it.
--
--  THE GRANT IS DERIVED, NOT LISTED
--
--  Rule 8 of the brief: do not hardcode approvers. So the block below does not
--  name a single permission. It copies whatever PLANNING_GM actually holds in
--  THIS database onto MERCHANDISING - which matters here, because the seed file
--  and this database have drifted apart and a hand-typed list would encode the
--  file's opinion rather than the office's. The union is exact by construction.
--
--  WHAT THIS COSTS, STATED PLAINLY
--
--  PLANNING.APPROVE arrives with the GM's set, so the surviving role can both
--  prepare a plan and approve it. That is not a new power - PLANNING_GM already
--  held CREATE and APPROVE together and could always self-approve - but it now
--  reaches the merchandising desk too.
--
--  WHAT IT DOES NOT COST
--
--  PLAN_APPROVAL.APPROVE is not in either set, so it is not in the union. The
--  formal plan sign-off stays with the Director, which is the separation that
--  carries the weight.
-- ===========================================================================

-- 1. Everything PLANNING_GM holds now also belongs to MERCHANDISING.
INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT m."id", rp."permission_id", CURRENT_TIMESTAMP
  FROM "roles" m
  JOIN "roles" g ON g."code" = 'PLANNING_GM'
  JOIN "role_permissions" rp ON rp."role_id" = g."id"
 WHERE m."code" = 'MERCHANDISING'
    ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- 2. Everyone holding PLANNING_GM now holds MERCHANDISING. Vinay ji keeps his
--    login and his access; only the role behind it changes name.
INSERT INTO "user_roles" ("user_id", "role_id", "created_at")
SELECT ur."user_id", m."id", CURRENT_TIMESTAMP
  FROM "roles" m
  JOIN "roles" g ON g."code" = 'PLANNING_GM'
  JOIN "user_roles" ur ON ur."role_id" = g."id"
 WHERE m."code" = 'MERCHANDISING'
    ON CONFLICT ("user_id", "role_id") DO NOTHING;

DELETE FROM "user_roles"
 WHERE "role_id" IN (SELECT "id" FROM "roles" WHERE "code" = 'PLANNING_GM');

-- 3. The surviving role is no longer only merchandising.
UPDATE "roles"
   SET "name" = 'Merchandising & Planning',
       "description" = 'Raises and maintains buyer orders, owns the cutting / '
                    || 'stitching / shipping and raw material plans end to end, '
                    || 'and submits them to the Director for approval.',
       "updated_at" = CURRENT_TIMESTAMP
 WHERE "code" = 'MERCHANDISING';

-- 4. Retire PLANNING_GM.
--
--    SOFT deleted, not dropped. Audit rows and historical approvals reference
--    this role id, and a hard delete would cascade its grants away and leave
--    those references pointing at nothing. Soft delete is also how the
--    application's own role administration removes a role, so the row behaves
--    from here exactly as an administrator-deleted role would.
UPDATE "roles"
   SET "deleted_at" = CURRENT_TIMESTAMP,
       "updated_at" = CURRENT_TIMESTAMP
 WHERE "code" = 'PLANNING_GM' AND "deleted_at" IS NULL;
