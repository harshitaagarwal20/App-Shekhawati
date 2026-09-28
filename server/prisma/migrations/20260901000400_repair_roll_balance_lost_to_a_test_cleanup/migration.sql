-- ===========================================================================
--  REPAIR - ONE ROLL BALANCE LOST TO THE SAME OVER-BROAD TEST CLEANUP
-- ===========================================================================
--
--  WHAT HAPPENED
--
--  The sibling of 20260829000300. That migration restored a stock_ledger row
--  the early version of test/c2-c9.e2e.test.js deleted; this one restores the
--  FABRIC ROLL the same run damaged, which was missed at the time because the
--  ledger and its balance cache still reconciled perfectly afterwards and
--  nothing compares a roll against the ledger.
--
--  On 2026-08-29 06:42:08 the test issued 40 Mtrs off FAB-006 - a SEEDED roll,
--  not one of its own - which mutated the roll in place:
--
--      stage       DYED              -> ISSUED_TO_CUTTING
--      location    NULL              -> CUTTING FLOOR
--      balance_qty 1470              -> 1430
--
--  Its cleanup then deleted the fabric issue and both ledger legs. Deleting an
--  append-only ledger row is symmetrical and leaves the ledger consistent; the
--  roll is NOT append-only, so the decrement stayed. FAB-006 has read 40 Mtrs
--  short of what its own documents support ever since:
--
--      received 1500  -  issued 1500 (FI-006, to dyeing)  +  returned 1470 (DR-004)
--        = 1470, against a stored balance of 1430
--
--  WHY THE FIGURES BELOW ARE NOT ESTIMATES
--
--  They are not derived and not guessed - they are the BEFORE values recorded
--  in audit_logs for that exact update. The audit trail is a separate table
--  and survived the cleanup that removed everything else, which is the whole
--  reason it exists. The migration reads them from there and refuses if it
--  cannot find them.
--
--  THE CAUSE IS ALREADY FIXED
--
--  The cleanup in that test is now scoped to `C2C9%` document numbers only,
--  and the test issues exclusively from rolls it creates itself (C2C9-ROLL-1,
--  C2C9-ROLL-OVER) which it then deletes. It can no longer reach a seeded
--  roll. This migration is the outstanding data, not a guard against a live
--  defect.
--
--  WHAT WOULD MAKE THIS CLASS OF DAMAGE VISIBLE NEXT TIME
--
--  Nothing reconciles fabric_rolls.balance_qty against the movements recorded
--  for that roll. The ledger checks itself against its own cache and passes;
--  a roll can drift from both without anything noticing. That check is worth
--  having as a report, and is noted in the audit rather than bolted on here.
-- ---------------------------------------------------------------------------

DO $do$
DECLARE
  r            RECORD;
  a            RECORD;
  issue_count  bigint;
  ledger_count bigint;
BEGIN
  SELECT "id", "roll_no", "received_qty", "balance_qty", "stage", "location"
    INTO r
    FROM "fabric_rolls"
   WHERE "roll_no" = 'FAB-006' AND "deleted_at" IS NULL;

  IF r."id" IS NULL THEN
    RAISE NOTICE 'FAB-006 is not present; nothing to repair.';
    RETURN;
  END IF;

  -- Only the damaged state is repaired. A freshly seeded database already
  -- reads 1470 / DYED and must be left exactly as it is.
  IF NOT (r."balance_qty" = 1430 AND r."stage" = 'ISSUED_TO_CUTTING') THEN
    RAISE NOTICE 'FAB-006 is not in the damaged state (balance %, stage %); nothing to repair.',
      r."balance_qty", r."stage";
    RETURN;
  END IF;

  -- The move must still be unaccounted for. If a real fabric issue or a real
  -- ledger movement has since been raised against this roll, the 40 Mtrs are
  -- somebody's genuine work and this migration must not undo it.
  SELECT count(*) INTO issue_count
    FROM "fabric_issues"
   WHERE "roll_id" = r."id" AND "deleted_at" IS NULL AND "issue_no" <> 'FI-006';

  SELECT count(*) INTO ledger_count
    FROM "stock_ledger"
   WHERE "roll_id" = r."id" AND "document_no" NOT IN ('GRN-004', 'FI-006', 'DR-004');

  IF issue_count > 0 OR ledger_count > 0 THEN
    RAISE NOTICE
      'FAB-006 now has % other issue(s) and % other ledger row(s); the balance is accounted for. Nothing repaired.',
      issue_count, ledger_count;
    RETURN;
  END IF;

  -- The before-values, read from the audit trail rather than assumed.
  SELECT "before" ->> 'balanceQty' AS bal,
         "before" ->> 'stage'      AS stage,
         "before" ->> 'location'   AS loc
    INTO a
    FROM "audit_logs"
   WHERE "record_id" = r."id"
     AND "action" = 'UPDATE'
     AND "before" ->> 'balanceQty' = '1470'
   ORDER BY "created_at" ASC
   LIMIT 1;

  IF a.bal IS NULL THEN
    RAISE EXCEPTION '%',
      'FAB-006 looks damaged but the audit entry recording its previous balance is gone, so the '
      || 'correct figure cannot be established from the database. Re-seed instead of guessing.';
  END IF;

  UPDATE "fabric_rolls"
     SET "balance_qty" = a.bal::numeric,
         "stage"       = a.stage::"RollStage",
         "location"    = a.loc,
         "remarks"     = COALESCE("remarks" || ' | ', '')
           || 'REPAIRED 2026-09-01. This roll was left 40 Mtrs short by the same over-broad '
           || 'cleanup in test/c2-c9.e2e.test.js that 20260829000300 repaired the ledger for: '
           || 'the test issued off this SEEDED roll and then deleted its own documents, and a '
           || 'roll is not append-only so the decrement stayed. Balance, stage and location are '
           || 'restored from the audit entry for that update. The test can no longer reach a '
           || 'seeded roll.',
         "updated_at"  = CURRENT_TIMESTAMP
   WHERE "id" = r."id";

  RAISE NOTICE 'Restored FAB-006 to % Mtrs, stage %, location %.', a.bal, a.stage, COALESCE(a.loc, 'NULL');
END
$do$;
