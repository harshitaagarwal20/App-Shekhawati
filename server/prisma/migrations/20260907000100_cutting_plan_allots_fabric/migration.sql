-- A cutting plan allots FABRIC, not cutting pieces.
--
-- What is handed to a cutting floor is cloth, measured in metres; what comes
-- back is panels. The plan line therefore states the fabric to be issued, and
-- the pieces column stays for stitching, shipping and packing - the three
-- departments that receive a count rather than a length.
--
-- `cutting_pcs_allotted` is NOT dropped. Cutting plans written before this
-- still hold the pieces they were made with, and emptying the column would
-- destroy the record of what those plans actually said.
--
-- Hand-written rather than generated. `prisma migrate diff` still wants to drop
-- a foreign key and thirteen indexes that exist in the database but are absent
-- from schema.prisma - drift from migrations edited after they were applied.
-- That is worth fixing, but it is not this change.

ALTER TABLE "planning_lines" ADD COLUMN "fabric_qty" DECIMAL(18,4);
ALTER TABLE "planning_lines" ADD COLUMN "fabric_uom" VARCHAR(20);

ALTER TABLE "plannings" ADD COLUMN "planned_fabric_qty" DECIMAL(18,4) NOT NULL DEFAULT 0;
