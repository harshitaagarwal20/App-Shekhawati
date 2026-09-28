-- ===========================================================================
--  STYLE UTILISATION: ZERO IS ALLOWED, AND MEANS "NOT DECIDED YET"
-- ===========================================================================
--
--  ---------------------------------------------------------------------------
--   THIS FINISHES A DECISION THAT WAS ONLY HALF APPLIED
--
--   C9 moved the refusal of a zero utilisation OUT of the write and INTO the
--   two documents it actually matters on. The reasoning is recorded in full at
--   validators/master.validator.js:204 and is worth restating, because this
--   migration is the other half of it:
--
--     A requirement must never be silently zero. That holds. But refusing the
--     WRITE did not achieve it - it only forced somebody to invent a figure
--     before sampling had decided one, and an INVENTED figure is the silent
--     one, because it caps procurement without anything ever saying so.
--
--   So `requirementFor()` treats a per-piece figure of <= 0 as NO REQUIREMENT
--   (reason NO_UTILISATION, naming the style), and `assertRequirement()` turns
--   that into a refusal on the purchase order and the cutting challan. A style
--   may be registered before its average is known; it simply cannot be
--   procured or cut against until it is.
--
--   The validators, the domain layer, the Style Master form ("Leave it 0 if
--   sampling has not decided it yet") and the C9 rule tests all made that move.
--   These two CHECK constraints did not, so the database went on refusing the
--   exact value the screen instructs the user to enter. Saving a new style with
--   the field left at 0 failed with a raw constraint name.
--
--   BOTH constraints move together, deliberately. `syncFabricLine()` mirrors
--   the style header's average onto the Fabric BOM line on every save, so
--   relaxing only `styles` would have moved the same failure one table across.
--
--   MATERIAL PLAN LINES ARE NOT TOUCHED. `material_plan_lines_utilisation_positive`
--   stays > 0 and is correct: a plan line exists only because a requirement was
--   successfully computed, and a requirement cannot compute from zero. There,
--   zero really is impossible data rather than an undecided figure.
--
--   RENAMED, NOT JUST REDEFINED. A constraint called "..._positive" that permits
--   zero is a trap for the next reader, and the name is what the API renders to
--   the user when a violation is not in errorHandler's CHECK_MESSAGES map.
--
--   NO BACKFILL. This only widens what is accepted, so every existing row
--   already satisfies the new form.
--  ---------------------------------------------------------------------------

-- --- 1. The style header's average ------------------------------------------

ALTER TABLE "styles"
  DROP CONSTRAINT IF EXISTS "styles_avg_utilization_positive";

ALTER TABLE "styles"
  ADD CONSTRAINT "styles_avg_utilization_non_negative"
  CHECK ("avg_fabric_utilization_per_pc" >= 0);

-- --- 2. The BOM line's utilisation ------------------------------------------

ALTER TABLE "style_bom_lines"
  DROP CONSTRAINT IF EXISTS "style_bom_lines_utilisation_positive";

ALTER TABLE "style_bom_lines"
  ADD CONSTRAINT "style_bom_lines_utilisation_non_negative"
  CHECK ("avg_utilisation_per_piece" >= 0);
