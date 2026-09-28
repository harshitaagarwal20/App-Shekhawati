-- ===========================================================================
--  ONE BAG, ONE SHADE - rolls carry their shade band and dye lot
-- ===========================================================================
--
--  The panels of one tote are stitched side by side, and cloth from two dye
--  batches differs by a shade the buyer's inspector sees across the seam.
--  A roll now records the shade band it was graded into and the dye house's
--  lot; a fabric issue snapshots both, and an issue that puts a second shade
--  or lot onto a cutting challan line already started on another is refused
--  unless it carries a reason (server/src/domain/shade.js).
--
--  Nothing is backfilled. No roll on file has been graded, and a guessed
--  shade is exactly the mistake this exists to prevent.
-- ===========================================================================

ALTER TABLE "fabric_rolls"
  ADD COLUMN "shade"                VARCHAR(20),
  ADD COLUMN "dye_lot"              VARCHAR(40),
  ADD COLUMN "shade_marked_at"      TIMESTAMPTZ(3),
  ADD COLUMN "shade_marked_by_name" VARCHAR(120);

CREATE INDEX "fabric_rolls_shade_idx" ON "fabric_rolls"("shade");
CREATE INDEX "fabric_rolls_dye_lot_idx" ON "fabric_rolls"("dye_lot");

ALTER TABLE "fabric_issues"
  ADD COLUMN "shade"            VARCHAR(20),
  ADD COLUMN "dye_lot"          VARCHAR(40),
  ADD COLUMN "shade_mix_reason" TEXT;

-- An override without words is not an override.
ALTER TABLE "fabric_issues"
  ADD CONSTRAINT "fabric_issues_shade_mix_reason_not_blank"
  CHECK ("shade_mix_reason" IS NULL OR length(btrim("shade_mix_reason")) >= 10);

-- ---------------------------------------------------------------------------
--  QC grades shade at the light box, so QC may now edit a roll's grading.
--  Granted to every role that already holds FABRIC_SCRUTINY.CREATE, rather
--  than to a role named here.
-- ---------------------------------------------------------------------------
INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT rp."role_id", np."id", CURRENT_TIMESTAMP
  FROM "permissions" np
  JOIN "permissions" lp ON lp."code" = 'FABRIC_SCRUTINY.CREATE'
  JOIN "role_permissions" rp ON rp."permission_id" = lp."id"
 WHERE np."code" = 'FABRIC_ROLL.EDIT'
   AND NOT EXISTS (
     SELECT 1 FROM "role_permissions" x
      WHERE x."role_id" = rp."role_id" AND x."permission_id" = np."id"
   );
