-- ===========================================================================
--  C8 - STAGE TIMING
-- ===========================================================================
--
--  ---------------------------------------------------------------------------
--   THE APPROVAL ENGINE ALREADY WRITES THE EVENT. IT IS approval_history.
--
--   C8 asks for a document_stage_events table carrying document_type,
--   document_id, from_state, to_state, actor and timestamp, written by the
--   approval engine itself so that no individual document implementation has
--   to remember to create one.
--
--   approval_history has all six columns (from_status, to_status,
--   acted_by_id / acted_by_name, acted_at) and is written by transition() -
--   the single function in this application that is allowed to move a
--   workflow state. Every approval-enabled document already receives an entry
--   on every transition, automatically, for exactly the reason C8 gives.
--
--   So document_stage_events is a VIEW over it, not a second table.
--
--   THIS IS THE STRONGER IMPLEMENTATION, not the cheaper one. A parallel table
--   would have to be written alongside approval_history on every transition,
--   which means two writes that can disagree, a backfill that can be
--   incomplete, and a "exactly one stage event per transition" test that only
--   holds while both writes keep working. A view cannot drift from its source:
--   one transition produces one approval_history row, and therefore exactly
--   one stage event, by construction.
--
--   The view is narrower than the table on purpose. approval_history also
--   records things that are NOT transitions - an AMENDED entry, a re-print -
--   and those carry no from/to pair. Stage timing is about movement, so the
--   view keeps only the rows where a state actually changed.
--
--   ---------------------------------------------------------------------------
--   GATE PASS MOVEMENT TIME
--
--   Nullable, because the eight gate passes that predate C8 have no record of
--   when the lorry actually crossed and nothing to reconstruct one from.
--   created_at is when the clerk typed it up - precisely the number C8 exists
--   to stop standing in for the movement - so inventing one would put a
--   fabricated timestamp on a gate record a dispute might turn on.
--
--   Mandatory for every row created after this migration, by CHECK.
--   Refused if it is in the future, by TRIGGER - a CHECK cannot do it,
--   because now() is not immutable and PostgreSQL will not accept it in one.
--  ---------------------------------------------------------------------------

-- --- 1. Gate pass movement time -------------------------------------------

ALTER TABLE "gate_passes" ADD COLUMN "movement_time" TIMESTAMPTZ(3);

CREATE INDEX "gate_passes_movement_time_idx" ON "gate_passes"("movement_time");

ALTER TABLE "gate_passes"
  ADD CONSTRAINT "gate_passes_new_rows_need_movement_time"
  CHECK (
    "created_at" < TIMESTAMPTZ '2026-08-27 00:00:00+00'
    OR "movement_time" IS NOT NULL
  );

CREATE OR REPLACE FUNCTION "gate_pass_movement_time_not_future"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW."movement_time" IS NOT NULL AND NEW."movement_time" > now() THEN
    RAISE EXCEPTION
      'C8: gate pass % records a movement time of %, which is in the future. A gate pass records goods that have already crossed.',
      NEW."gate_pass_no", NEW."movement_time"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER "gate_passes_movement_time_not_future"
  BEFORE INSERT OR UPDATE ON "gate_passes"
  FOR EACH ROW
  EXECUTE FUNCTION "gate_pass_movement_time_not_future"();

-- --- 2. The stage events --------------------------------------------------

CREATE VIEW "document_stage_events" AS
SELECT
    h."id",
    h."document_type",
    h."document_id",
    h."document_no",
    h."sequence_no",
    h."action",
    h."from_status" AS "from_state",
    h."to_status"   AS "to_state",
    h."acted_by_id"   AS "actor_id",
    h."acted_by_name" AS "actor",
    h."acted_at"      AS "occurred_at",
    h."remarks"
  FROM "approval_history" h
 -- Only actual movement. An amendment or a re-print is on the trail but is
 -- not a stage change and has no from/to pair to measure.
 WHERE h."from_status" IS NOT NULL
   AND h."to_status" IS NOT NULL
   AND h."from_status" <> h."to_status";

COMMENT ON VIEW "document_stage_events" IS
  'C8. One row per workflow state transition, for every approval-enabled document. Written automatically by approvalEngine.transition(), which is the only function permitted to move a workflow state - so a document type cannot fail to emit these by forgetting to. A view over approval_history rather than a second table, so the two can never disagree.';

-- --- 3. How long each stage took ------------------------------------------
--
--  The reportable half of C8: for each document, how long it SAT in the state
--  it was leaving. Measured from the previous transition on the same document,
--  which is the moment it entered that state; the first transition of a
--  document measures from its own creation, which the source table does not
--  know, so entered_at is null there and the duration with it.

CREATE VIEW "document_stage_durations" AS
SELECT
    e."document_type",
    e."document_id",
    e."document_no",
    e."sequence_no",
    e."from_state",
    e."to_state",
    e."actor",
    e."actor_id",
    LAG(e."occurred_at") OVER w AS "entered_at",
    e."occurred_at"             AS "left_at",
    EXTRACT(EPOCH FROM (e."occurred_at" - LAG(e."occurred_at") OVER w)) AS "duration_seconds",
    ROUND(
      (EXTRACT(EPOCH FROM (e."occurred_at" - LAG(e."occurred_at") OVER w)) / 3600)::numeric,
      2
    ) AS "duration_hours"
  FROM "document_stage_events" e
WINDOW w AS (PARTITION BY e."document_type", e."document_id" ORDER BY e."occurred_at", e."sequence_no");

COMMENT ON VIEW "document_stage_durations" IS
  'C8. Per-document stage durations, ready for reporting: how long each document sat in the state it then left. duration is null for the first transition of a document, because the state it started in was entered at creation and approval_history does not record that.';
