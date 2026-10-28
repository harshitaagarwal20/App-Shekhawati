-- Who a fabric issue is handed to: the cutting contractor, for a cutting
-- issue. Nullable - issues raised before it was asked have no such name, and
-- one is not invented for them.
ALTER TABLE "fabric_issues" ADD COLUMN "issued_to_name" VARCHAR(120);
