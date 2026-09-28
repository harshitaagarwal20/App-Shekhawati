-- ===========================================================================
--  THE OFFICE'S DECISION ON THE TWO REPORTED CONFLICTS: 3%, BOTH TIMES
-- ===========================================================================
--
--  The C2/C9 implementation report raised two disagreements rather than
--  resolving them, because neither was mine to resolve. Both were the same
--  shape - 5% against 3% - and the office has decided 3% for both.
--
--    1. ACCESSORIES RECEIPT TOLERANCE
--       The C2 brief specified 5%. The approved master (excess_rules,
--       ITEM_CATEGORY / Accessories / GRN) has said 3%, with a 3% hard
--       ceiling, since Phase 17. Decision: 3% - the figure the office had
--       already agreed and had been running on.
--
--    2. WASHING SHRINKAGE TOLERANCE
--       jobWork.service.js PROCESS_META has been enforcing 5%. The C3 brief
--       describes a band of approximately 2-3%. Decision: 3% - the top of the
--       brief's band.
--
--  ---------------------------------------------------------------------------
--   WHY THIS CORRECTS THE ROWS INSTEAD OF SUPERSEDING THEM
--
--   The versioning rule in this system is that an agreed version is immutable
--   and a change creates a successor, so that a historical document keeps
--   reproducing the verdict it was actually given.
--
--   That rule protects DECISIONS. Neither of these figures was one. The 5%
--   accessories receipt tolerance came from a brief and was never agreed by
--   the office; the 5% washing figure was a constant lifted out of a service
--   file two days ago so it could be seen and argued about - which is exactly
--   what has now happened.
--
--   And nothing has been judged by either. Verified below rather than assumed:
--   if any purchase order, GRN or job work order turns out to carry one of
--   these figures, this migration REFUSES and the correction has to be made as
--   a superseding version instead. That is the one case where correcting in
--   place would rewrite a verdict somebody had already been given.
--
--   NOTE ON EXISTING DOCUMENTS: even if one did exist, it would be unaffected.
--   Both tolerances are FROZEN ON THE DOCUMENT at creation - that is the whole
--   point of C2's design - so editing a master can never retrospectively
--   re-judge a document that quoted it. The guard below is about the integrity
--   of the master's own history, not about the documents.
--  ---------------------------------------------------------------------------

-- --- 1. Refuse if either figure was ever actually applied -------------------

DO $do$
DECLARE
  judged_pos   bigint;
  judged_grns  bigint;
  judged_jobs  bigint;
BEGIN
  SELECT count(*) INTO judged_pos
    FROM "purchase_orders"
   WHERE "category" = 'ACCESSORIES' AND "receipt_tolerance_pct" = 0.050000;

  SELECT count(*) INTO judged_grns
    FROM "grns"
   WHERE "category" = 'ACCESSORIES' AND "receipt_tolerance_pct" = 0.050000;

  SELECT count(*) INTO judged_jobs
    FROM "dye_issues"
   WHERE "process" = 'WASHING' AND "shrinkage_tolerance_pct" = 0.050000;

  IF judged_pos > 0 OR judged_grns > 0 OR judged_jobs > 0 THEN
    RAISE EXCEPTION
      'Correction refused: % purchase order(s), % GRN(s) and % job work order(s) were already judged by the 5%% figures. Those are decisions on the record. Supersede the versions with new dated ones instead of editing them.',
      judged_pos, judged_grns, judged_jobs;
  END IF;
END
$do$;

-- --- 2. Accessories: receipt tolerance 5% -> 3% -----------------------------

UPDATE "tolerance_rules"
   SET "receipt_tolerance_pct" = 0.030000,
       -- basis is VARCHAR(255). The full reasoning lives in this migration and
       -- in the implementation report; this is the line that prints on screen.
       "basis" =
         'Order 1% over requirement; receive 3% over order. The 3% is the figure already approved '
         || 'in excess_rules, confirmed by the office over the 5% the C2 brief proposed.',
       "updated_at" = CURRENT_TIMESTAMP
 WHERE "category" = 'ACCESSORIES'
   AND "receipt_tolerance_pct" = 0.050000;

-- The order tolerance is untouched: 1% was never in dispute.

-- --- 3. Washing: shrinkage tolerance 5% -> 3% -------------------------------

UPDATE "shrinkage_rules"
   SET "shrinkage_tolerance_pct" = 0.030000,
       "basis" =
         'Washing shrinkage at the top of the 2-3% band the C3 brief describes. Replaces the 5% '
         || 'PROCESS_META was enforcing, which sat outside that band. No lot was raised under it.',
       "updated_at" = CURRENT_TIMESTAMP
 WHERE "process" = 'WASHING'
   AND "vendor_id" IS NULL
   AND "shrinkage_tolerance_pct" = 0.050000;

-- --- 4. Prove both corrections landed --------------------------------------
--
--  A migration whose UPDATE matched nothing is a migration that silently did
--  not run. Both rows are expected to exist and to have moved.

DO $do$
DECLARE
  acc numeric;
  wash numeric;
BEGIN
  SELECT "receipt_tolerance_pct" INTO acc
    FROM "tolerance_rules" WHERE "category" = 'ACCESSORIES' AND "deleted_at" IS NULL
   ORDER BY "effective_from" DESC LIMIT 1;

  SELECT "shrinkage_tolerance_pct" INTO wash
    FROM "shrinkage_rules" WHERE "process" = 'WASHING' AND "vendor_id" IS NULL AND "deleted_at" IS NULL
   ORDER BY "effective_from" DESC LIMIT 1;

  IF acc IS DISTINCT FROM 0.030000 THEN
    RAISE EXCEPTION 'Accessories receipt tolerance is % after the correction, expected 0.030000.', acc;
  END IF;
  IF wash IS DISTINCT FROM 0.030000 THEN
    RAISE EXCEPTION 'Washing shrinkage tolerance is % after the correction, expected 0.030000.', wash;
  END IF;
END
$do$;
