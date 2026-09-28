-- ===========================================================================
--  F-04 - GRN REVERSAL
-- ===========================================================================
--
--  ---------------------------------------------------------------------------
--   THE ERROR MESSAGE THAT NAMED A REMEDY THAT DID NOT EXIST
--
--   A GRN posts to stock inside its own create transaction. `posted_at` is
--   stamped and `workflow_state` set to POSTED the instant the receipt is
--   saved; there is deliberately no separate post endpoint, because a
--   half-posted receipt is a worse thing to own than no receipt at all.
--
--   From that moment the receipt was frozen. `setStatus()` refused to cancel
--   it and `remove()` refused to delete it, and both said the same thing to
--   the user:
--
--       "A posted receipt is corrected by a reversal, not by a status change."
--
--   There was no reversal. No route, no controller, no service, no column.
--   A storeman who keyed 1,000 m instead of 100, or chose the wrong purchase
--   order, or mistyped the rate, had committed that to the stock ledger before
--   they could re-read the screen - and the only way back was hand-written SQL
--   against the production database, which is exactly the thing an append-only
--   ledger is supposed to make unnecessary.
--
--   The immutable-ledger design was right. Its other half - a compensating
--   document - was specified in the error copy and never built. This is it.
--
--  ---------------------------------------------------------------------------
--   WHY A NEW TABLE RATHER THAN A NEGATIVE ROW IN `grns`
--
--   The tempting shape is another GRN with the quantity negated. Four CHECK
--   constraints on `grns` refuse it, and each of them is worth keeping:
--
--     grns_receiving_qty_non_negative     a receipt of minus 1,000 metres
--     grns_amount_is_qty_x_rate           amount would have to be negative too
--     grns_variation_is_the_formula       variance against the PO is meaningless
--     grns_cumulative_covers_this_receipt cumulative >= this receipt fails
--
--   Relaxing four constraints so that one row may lie about being a receipt
--   would cost every other row the protection they give. And a reversal is not
--   a receipt in any other sense either: it carries a reason and an approver,
--   and carries no bill, no tolerance assessment and no GST, because the bill
--   it undoes is already on the GRN.
--
--  ---------------------------------------------------------------------------
--   THE RECEIPT IS STAMPED, NOT REWRITTEN
--
--   `grns.reversed_at` records that a reversal posted against this receipt.
--   Neither `workflow_state` nor `status` is touched, and that is deliberate:
--   the receipt WAS posted and the goods DID arrive, so both columns are still
--   telling the truth. What has changed is that an equal and opposite set of
--   ledger movements now stands beside them.
--
--   This is the credit-note shape, not the delete-the-invoice shape. The
--   history stays legible: a reader a year later sees the receipt, sees the
--   reversal, sees the reason, and sees who signed it.
--
--  ---------------------------------------------------------------------------
--   THE BILL NUMBER HAD TO BE FREED, OR THE WHOLE THING IS USELESS
--
--   `grns_purchase_order_id_bill_no_key` was a plain unique index on
--   (purchase_order_id, bill_no). Right rule, wrong scope: it counted
--   soft-deleted and reversed receipts as well as live ones.
--
--   That breaks the primary use case. Reverse the mis-keyed receipt for bill
--   12345 and the storeman still cannot re-enter bill 12345 correctly, because
--   the wrong receipt is still holding the number. The reversal would undo the
--   stock and then block the correction.
--
--   Replaced below with a PARTIAL unique index over the receipts that still
--   stand. This also fixes the pre-existing case of a soft-deleted receipt
--   holding a bill number hostage, which was the same bug without a name.
--
--  ---------------------------------------------------------------------------
--   NO BACKFILL
--
--   No existing receipt gets a retrospective reversal. There is nothing to
--   invent: `reversed_at` is NULL for every row, which is the correct reading -
--   none of them has been reversed.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. The document type.
--
--  Its own value rather than reusing GRN, so a stock ledger row says which of
--  the two documents moved it. A movement that reads "GRN / GRV-0001" would be
--  the ledger lying about its own source.
--
--  PostgreSQL will not let a transaction USE an enum value it added itself, so
--  everything that has to reference 'GRN_REVERSAL' as a value - the document
--  number sequence - is in the migration that follows this one.
-- ---------------------------------------------------------------------------
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'GRN_REVERSAL';

-- ---------------------------------------------------------------------------
--  2. The stamp on the receipt.
-- ---------------------------------------------------------------------------
ALTER TABLE "grns"
  ADD COLUMN IF NOT EXISTS "reversed_at"      TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "reversed_by_id"   UUID,
  ADD COLUMN IF NOT EXISTS "reversed_by_name" VARCHAR(120);

ALTER TABLE "grns"
  -- A reversal names the person who signed it, exactly as posting does
  -- (grns_posted_is_stamped). An unattributed correction is not a correction.
  ADD CONSTRAINT "grns_reversed_is_stamped"
    CHECK ("reversed_at" IS NULL OR "reversed_by_name" IS NOT NULL),
  -- Only a receipt that reached the ledger has anything to reverse. A GRN with
  -- no posted_at never moved stock, and is deleted rather than reversed.
  ADD CONSTRAINT "grns_only_posted_is_reversed"
    CHECK ("reversed_at" IS NULL OR "posted_at" IS NOT NULL);

CREATE INDEX IF NOT EXISTS "grns_reversed_at_idx" ON "grns"("reversed_at");
CREATE INDEX IF NOT EXISTS "grns_purchase_order_id_bill_no_idx"
  ON "grns"("purchase_order_id", "bill_no");

-- ---------------------------------------------------------------------------
--  3. One live bill per purchase order - counting only the receipts that stand.
--
--  Dropped and replaced rather than altered: a partial index is a different
--  index, and the old one is what would refuse the re-entry.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "grns_purchase_order_id_bill_no_key";

CREATE UNIQUE INDEX IF NOT EXISTS "grns_live_bill_per_po"
  ON "grns"("purchase_order_id", "bill_no")
  WHERE "deleted_at" IS NULL AND "reversed_at" IS NULL;

-- ---------------------------------------------------------------------------
--  4. The reversal itself.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "grn_reversals" (
  "id"                UUID            NOT NULL DEFAULT gen_random_uuid(),

  "workflow_state"    "DocumentState" NOT NULL DEFAULT 'DRAFT',

  "reversal_no"       VARCHAR(40)     NOT NULL,
  "reversal_date"     DATE            NOT NULL,

  "grn_id"            UUID            NOT NULL,
  "reason"            TEXT            NOT NULL,

  -- What it undoes, frozen at creation and re-checked against the receipt at
  -- posting. If the two ever disagree the reversal refuses to post rather than
  -- moving a quantity nobody authorised.
  "reversed_qty"      DECIMAL(18, 4)  NOT NULL,
  "reversed_amount"   DECIMAL(18, 2)  NOT NULL,
  "uom"               VARCHAR(20)     NOT NULL,
  "location"          VARCHAR(80)     NOT NULL,

  "inventory_item_id" UUID,
  "roll_count"        INTEGER         NOT NULL DEFAULT 0,

  "approval_status"   "StatusApproval" NOT NULL DEFAULT 'PENDING',

  "submitted_to"      VARCHAR(120),
  "submitted_at"      TIMESTAMPTZ(3),
  "submitted_by_id"   UUID,
  "submitted_by_name" VARCHAR(120),

  "approved_at"       TIMESTAMPTZ(3),
  "approved_by_id"    UUID,
  "approved_by_name"  VARCHAR(120),
  "decided_at"        TIMESTAMPTZ(3),
  "rejection_reason"  TEXT,

  "posted_at"         TIMESTAMPTZ(3),
  "posted_by_id"      UUID,
  "posted_by_name"    VARCHAR(120),

  "remarks"           TEXT,

  "created_at"        TIMESTAMPTZ(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id"     UUID,
  "updated_at"        TIMESTAMPTZ(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_id"     UUID,
  "deleted_at"        TIMESTAMPTZ(3),
  "deleted_by_id"     UUID,

  CONSTRAINT "grn_reversals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "grn_reversals_reversal_no_key"
  ON "grn_reversals"("reversal_no");
CREATE INDEX IF NOT EXISTS "grn_reversals_grn_id_idx"          ON "grn_reversals"("grn_id");
CREATE INDEX IF NOT EXISTS "grn_reversals_workflow_state_idx"  ON "grn_reversals"("workflow_state");
CREATE INDEX IF NOT EXISTS "grn_reversals_reversal_date_idx"   ON "grn_reversals"("reversal_date");
CREATE INDEX IF NOT EXISTS "grn_reversals_inventory_item_id_idx" ON "grn_reversals"("inventory_item_id");
CREATE INDEX IF NOT EXISTS "grn_reversals_deleted_at_idx"      ON "grn_reversals"("deleted_at");

ALTER TABLE "grn_reversals"
  ADD CONSTRAINT "grn_reversals_grn_id_fkey"
    FOREIGN KEY ("grn_id") REFERENCES "grns"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "grn_reversals_inventory_item_id_fkey"
    FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
--  5. AT MOST ONE LIVE REVERSAL PER RECEIPT.
--
--  "Live" excludes rejected and cancelled ones: a reversal the approver turned
--  down must not block a corrected one being raised, and neither must one
--  somebody withdrew. A soft-deleted draft does not count either.
--
--  This is what makes "full reversal only" a database fact rather than a
--  service-layer convention. Without it two reversals of the same receipt
--  could both pass their checks and both post, taking the stock out twice.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "grn_reversals_one_live_per_grn"
  ON "grn_reversals"("grn_id")
  WHERE "deleted_at" IS NULL
    AND "workflow_state" NOT IN ('REJECTED', 'CANCELLED');

-- ---------------------------------------------------------------------------
--  6. What the row is not allowed to say.
--
--  The same treatment the rest of this schema gives its documents: the rules
--  that must hold whatever the service layer does, stated where no code path
--  can get around them.
-- ---------------------------------------------------------------------------
ALTER TABLE "grn_reversals"
  -- A reversal of nothing is not a document. Quantity is strictly positive;
  -- the OUT direction is what makes it a reversal, not a negative number.
  ADD CONSTRAINT "grn_reversals_qty_positive"
    CHECK ("reversed_qty" > 0),
  ADD CONSTRAINT "grn_reversals_amount_non_negative"
    CHECK ("reversed_amount" >= 0),
  ADD CONSTRAINT "grn_reversals_roll_count_non_negative"
    CHECK ("roll_count" >= 0),

  -- WHY, in words. Ten characters is not a bar to clear so much as a floor
  -- under "x" and ".": this field is the only account of what went wrong that
  -- anybody will have in a year, and the screen asks for it in a textarea.
  ADD CONSTRAINT "grn_reversals_reason_is_a_sentence"
    CHECK (LENGTH(BTRIM("reason")) >= 10),

  -- Posting stamps who did it, exactly as grns_posted_is_stamped does.
  ADD CONSTRAINT "grn_reversals_posted_is_stamped"
    CHECK ("posted_at" IS NULL OR "posted_by_name" IS NOT NULL),

  -- A posted reversal has moved stock, so it must name the item it moved.
  ADD CONSTRAINT "grn_reversals_posted_has_item"
    CHECK ("posted_at" IS NULL OR "inventory_item_id" IS NOT NULL),

  -- Posting follows approval and nothing else. This is the constraint that
  -- makes the maker-checker rule in approvalEngine.transition() structural
  -- rather than procedural: a reversal cannot reach the ledger by any path
  -- that did not go through an approval first.
  ADD CONSTRAINT "grn_reversals_posted_was_approved"
    CHECK ("posted_at" IS NULL OR "approved_at" IS NOT NULL),

  -- A rejection carries its reason, as everywhere else in this schema.
  ADD CONSTRAINT "grn_reversals_rejected_has_reason"
    CHECK ("approval_status" <> 'REJECTED' OR "rejection_reason" IS NOT NULL);

-- ---------------------------------------------------------------------------
--  7. The audit trail covers it.
--
--  `grn_reversals` is added to config/auditedTables.js on the application
--  side; nothing is needed here, because the trail is written by a Prisma
--  client extension rather than by triggers. Noted so the absence of a trigger
--  is not read as an omission.
-- ---------------------------------------------------------------------------
