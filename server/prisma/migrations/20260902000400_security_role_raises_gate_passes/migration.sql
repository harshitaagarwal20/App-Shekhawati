-- ===========================================================================
--  THE GATE RAISES THE GATE PASS
-- ===========================================================================
--
--  Until now GATE_PASS.CREATE sat with STORE_MANAGER, because the workbook's
--  "Role Acess" header put gate passes beside GRN and the store owned both.
--  That is not who fills the form in. The person standing at the barrier when
--  the lorry arrives is the security guard, and a pass written up later by the
--  store from what the guard told them is exactly the second-hand record the
--  movement_time column exists to stop.
--
--  So the gate gets a login of its own, holding the narrowest set of
--  permissions in the application.
--
--  WHAT IT DELIBERATELY DOES NOT GET
--
--    GATE_PASS.EDIT     Allocating the pass to its purchase order is desk work
--                       done by whoever holds the paperwork. The guard does not
--                       know which PO a load answers and should not guess.
--    GATE_PASS.APPROVE  Clearing a pass states how much actually arrived. That
--                       is a count somebody is answerable for; it stays with
--                       the store and the Director.
--
--  STORE_MANAGER keeps everything it had, GATE_PASS.CREATE included. The gate
--  is now the normal way a pass is raised, but the store still needs to raise
--  one for a movement that never passed the barrier - a correction, or goods
--  that moved between buildings. Nothing was taken away from anybody.
-- ===========================================================================

INSERT INTO "roles" ("id", "code", "name", "description", "is_system",
                     "created_at", "updated_at")
SELECT gen_random_uuid(),
       'SECURITY',
       'Security (Gate)',
       'The gate. Raises inward and outward gate passes as vehicles arrive and '
       || 'leave. Does not allocate a pass to a document, clear it, or see '
       || 'anything else.',
       TRUE,
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
 WHERE NOT EXISTS (SELECT 1 FROM "roles" WHERE "code" = 'SECURITY');

-- The four permissions, named explicitly. This is a new role with no existing
-- equivalent to derive from, so there is nothing to carry forward.
-- role_permissions is keyed on (role_id, permission_id) and has no id column.
INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT r."id", p."id", CURRENT_TIMESTAMP
  FROM "roles" r
  JOIN "permissions" p
    ON p."code" IN ('GATE_PASS.VIEW', 'GATE_PASS.CREATE', 'GATE_PASS.EXPORT',
                    'VENDOR.VIEW')
 WHERE r."code" = 'SECURITY'
    ON CONFLICT ("role_id", "permission_id") DO NOTHING;
