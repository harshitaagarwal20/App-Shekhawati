-- ===========================================================================
--  F-04 - THE COUNTER REVERSALS ARE NUMBERED FROM, AND WHO MAY RAISE ONE
-- ===========================================================================
--
--  Separated from the migration that created the table for the same reason the
--  C5 and C12 sequences were: PostgreSQL will not let a transaction USE an
--  enum value it added itself, and 20260901000100 is the transaction that adds
--  GRN_REVERSAL to "DocumentType". The row below has to be inserted after that
--  transaction has committed.
--
--  Without it nextNumber('GRN_REVERSAL') refuses - correct behaviour for an
--  unconfigured sequence, and useless behaviour for a shipped feature.
--
--  GRV-0001, four digits, matching the C-series documents. GRV and not GRN-R:
--  the two appear side by side on the same screen and on the same ledger rows,
--  and a prefix that is a superstring of another prefix is a prefix that gets
--  misread.
-- ===========================================================================

INSERT INTO "document_sequences"
  ("id", "document_type", "scope_key", "prefix", "suffix", "separator",
   "pad_length", "next_number", "created_at", "updated_at")
SELECT gen_random_uuid(), 'GRN_REVERSAL', '', 'GRV', '', '-', 4, 1,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 WHERE NOT EXISTS (
   SELECT 1 FROM "document_sequences"
    WHERE "document_type" = 'GRN_REVERSAL' AND "scope_key" = ''
 );

-- ===========================================================================
--  THE PERMISSIONS
-- ===========================================================================
--
--  ---------------------------------------------------------------------------
--   WHO GETS THEM, AND WHY IT IS DERIVED RATHER THAN LISTED
--
--   Rule 8 of the brief: do not hardcode approvers. So no role is named below.
--   Each new permission is granted to exactly the roles that ALREADY hold the
--   closest existing equivalent, and the office's own decisions about who does
--   what carry forward without anybody re-stating them:
--
--     GRN_REVERSAL.VIEW    -> whoever holds GRN.VIEW
--     GRN_REVERSAL.CREATE  -> whoever holds GRN.CREATE.   The person who can
--                             raise a receipt is the person who discovers it
--                             was wrong. Raising the correction is part of the
--                             same job; SIGNING it is not.
--     GRN_REVERSAL.EDIT    -> whoever holds GRN.CREATE, for the same reason.
--                             Editing only ever touches a draft.
--     GRN_REVERSAL.DELETE  -> whoever holds GRN.DELETE. Only a draft can be
--                             deleted; a posted reversal is as permanent as
--                             the receipt it undid.
--     GRN_REVERSAL.EXPORT  -> whoever holds GRN.EXPORT
--     GRN_REVERSAL.APPROVE -> whoever holds PURCHASE_ORDER.APPROVE, because
--                             reversing a receipt moves the purchase order's
--                             payable quantity, and the office that authorises
--                             what is bought is the office that authorises
--                             un-booking what was received.
--
--   Note what that mapping does NOT do: it does not give GRN_REVERSAL.APPROVE
--   to anybody holding GRN.CREATE. The store raises the correction and the
--   Director signs it. That separation is the point of the document.
--
--   MAKER-CHECKER IS SEPARATE AND IS NOT A PERMISSION. Holding
--   GRN_REVERSAL.APPROVE does not let you approve YOUR OWN reversal -
--   approvalEngine.transition() refuses that regardless of role, because it is
--   a different control from "may this person approve reversals at all".
-- ===========================================================================

INSERT INTO "permissions" ("id", "code", "module", "action", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), v.code, v.module, v.action, v.description, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM (VALUES
    ('GRN_REVERSAL.VIEW', 'GRN_REVERSAL', 'VIEW',
     'F-04: see the corrections raised against posted goods receipts.'),
    ('GRN_REVERSAL.CREATE', 'GRN_REVERSAL', 'CREATE',
     'F-04: raise a reversal against a posted receipt, with a reason.'),
    ('GRN_REVERSAL.EDIT', 'GRN_REVERSAL', 'EDIT',
     'F-04: amend or submit a reversal while it is still a draft.'),
    ('GRN_REVERSAL.DELETE', 'GRN_REVERSAL', 'DELETE',
     'F-04: delete a draft reversal that was raised in error.'),
    ('GRN_REVERSAL.EXPORT', 'GRN_REVERSAL', 'EXPORT',
     'F-04: export or print a reversal.'),
    ('GRN_REVERSAL.APPROVE', 'GRN_REVERSAL', 'APPROVE',
     'F-04: authorise a reversal, which posts the counter-movements and takes the goods back out of stock.')
  ) AS v(code, module, action, description)
 WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."code" = v.code);

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT rp."role_id", np."id", CURRENT_TIMESTAMP
  FROM (VALUES
    ('GRN_REVERSAL.VIEW',    'GRN.VIEW'),
    ('GRN_REVERSAL.CREATE',  'GRN.CREATE'),
    ('GRN_REVERSAL.EDIT',    'GRN.CREATE'),
    ('GRN_REVERSAL.DELETE',  'GRN.DELETE'),
    ('GRN_REVERSAL.EXPORT',  'GRN.EXPORT'),
    ('GRN_REVERSAL.APPROVE', 'PURCHASE_ORDER.APPROVE')
  ) AS m(new_code, like_code)
  JOIN "permissions" np ON np."code" = m.new_code
  JOIN "permissions" lp ON lp."code" = m.like_code
  JOIN "role_permissions" rp ON rp."permission_id" = lp."id"
 WHERE NOT EXISTS (
   SELECT 1 FROM "role_permissions" x
    WHERE x."role_id" = rp."role_id" AND x."permission_id" = np."id"
 );
