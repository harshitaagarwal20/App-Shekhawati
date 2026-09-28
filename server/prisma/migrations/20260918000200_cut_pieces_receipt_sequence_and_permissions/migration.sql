-- ===========================================================================
--  CUT PIECES RECEIPT - its counter, and who may use it
-- ===========================================================================
--
--  Separate from 20260918000100 because that transaction adds
--  CUT_PIECES_RECEIPT to "DocumentType", and PostgreSQL will not let the same
--  transaction use it. CPR-0001, four digits, matching the C-series.
-- ===========================================================================

INSERT INTO "document_sequences"
  ("id", "document_type", "scope_key", "prefix", "suffix", "separator",
   "pad_length", "next_number", "created_at", "updated_at")
SELECT gen_random_uuid(), 'CUT_PIECES_RECEIPT', '', 'CPR', '', '-', 4, 1,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 WHERE NOT EXISTS (
   SELECT 1 FROM "document_sequences"
    WHERE "document_type" = 'CUT_PIECES_RECEIPT' AND "scope_key" = ''
 );

-- ===========================================================================
--  THE PERMISSIONS
--
--  Granted to whoever already holds the matching CUTTING_ISSUE permission: the
--  desk that issues cut pieces to stitching is the desk that counts them in
--  from the cutting floor. No role is named here.
-- ===========================================================================

INSERT INTO "permissions" ("id", "code", "module", "action", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), v.code, v.module, v.action, v.description, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM (VALUES
    ('CUT_PIECES_RECEIPT.VIEW', 'CUT_PIECES_RECEIPT', 'VIEW', 'View cut pieces receipt'),
    ('CUT_PIECES_RECEIPT.CREATE', 'CUT_PIECES_RECEIPT', 'CREATE', 'Create cut pieces receipt'),
    ('CUT_PIECES_RECEIPT.EDIT', 'CUT_PIECES_RECEIPT', 'EDIT', 'Edit cut pieces receipt'),
    ('CUT_PIECES_RECEIPT.DELETE', 'CUT_PIECES_RECEIPT', 'DELETE', 'Delete cut pieces receipt'),
    ('CUT_PIECES_RECEIPT.EXPORT', 'CUT_PIECES_RECEIPT', 'EXPORT', 'Export cut pieces receipt')
  ) AS v(code, module, action, description)
 WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."code" = v.code);

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT rp."role_id", np."id", CURRENT_TIMESTAMP
  FROM (VALUES
    ('CUT_PIECES_RECEIPT.VIEW',   'CUTTING_ISSUE.VIEW'),
    ('CUT_PIECES_RECEIPT.CREATE', 'CUTTING_ISSUE.CREATE'),
    ('CUT_PIECES_RECEIPT.EDIT',   'CUTTING_ISSUE.EDIT'),
    ('CUT_PIECES_RECEIPT.DELETE', 'CUTTING_ISSUE.DELETE'),
    ('CUT_PIECES_RECEIPT.EXPORT', 'CUTTING_ISSUE.EXPORT')
  ) AS m(new_code, like_code)
  JOIN "permissions" np ON np."code" = m.new_code
  JOIN "permissions" lp ON lp."code" = m.like_code
  JOIN "role_permissions" rp ON rp."permission_id" = lp."id"
 WHERE NOT EXISTS (
   SELECT 1 FROM "role_permissions" x
    WHERE x."role_id" = rp."role_id" AND x."permission_id" = np."id"
 );
