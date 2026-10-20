-- Submit, recall and revise on a plan wrote `approval_status` / `submitted_at`
-- but never `workflow_state`, so submitted plans stayed DRAFT on the column the
-- approval queue reads and never reached the approver. Re-derive it from the
-- columns that were kept, exactly as the original backfill did.
UPDATE "plannings" SET "workflow_state" =
  CASE "approval_status"
    WHEN 'APPROVED' THEN 'APPROVED'::"DocumentState"
    WHEN 'REJECTED' THEN 'REJECTED'::"DocumentState"
    ELSE CASE WHEN "submitted_at" IS NOT NULL
              THEN 'PENDING_APPROVAL'::"DocumentState"
              ELSE 'DRAFT'::"DocumentState" END
  END
WHERE "workflow_state" <> 'CANCELLED';
