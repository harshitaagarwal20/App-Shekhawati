-- Who was driving the lorry.
--
-- The pass already records the number plate, which identifies the vehicle.
-- This identifies the person, which is the other half of what a guard is asked
-- for when a consignment is disputed.
--
-- Nullable, like vehicle_no and for the same reason: goods carried in by hand
-- have no driver, and a NOT NULL column the gate cannot fill is a column the
-- gate fills with rubbish.
--
-- Hand-written rather than generated. `prisma migrate diff` still wants to drop
-- a foreign key and thirteen indexes that exist in the database but are not
-- declared in schema.prisma - drift from migrations edited after they were
-- applied. That is a real problem, but it is not this change, and dropping
-- those indexes as a side effect of adding a column would be a bad trade.

ALTER TABLE "gate_passes" ADD COLUMN "driver_name" VARCHAR(120);
