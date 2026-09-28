-- ===========================================================================
--  VENDOR MASTER GETS CITY AND VENDOR LOCATION
-- ===========================================================================
--
--  The Vendor Master sheet lists six identifying columns - Vendor Code, Vendor
--  Name, Address, City, Vendor Location and GSTN - and two of them had nowhere
--  to live. `address` is a free-text block, so "which city is this vendor in"
--  could only be answered by reading it, and "which vendors are at this
--  location" could not be answered at all.
--
--  City and Vendor Location are separate on purpose. A vendor bills from an
--  office and does the work somewhere else often enough that folding the two
--  together loses the distinction the store actually needs: the address on the
--  paperwork, and the place the fabric is sent.
--
--  Both are nullable. Every vendor already on file predates the columns, and a
--  master row is not wrong for being incomplete - it is filled in as the office
--  gets to it, not blocked at the door.
-- ---------------------------------------------------------------------------

ALTER TABLE "vendors" ADD COLUMN "city" VARCHAR(120);
ALTER TABLE "vendors" ADD COLUMN "vendor_location" VARCHAR(120);
