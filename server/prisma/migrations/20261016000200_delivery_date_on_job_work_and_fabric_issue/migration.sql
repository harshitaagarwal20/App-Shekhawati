-- ===========================================================================
--  DELIVERY DATE ON JOB WORK AND FABRIC ISSUE
-- ===========================================================================
--
--  When the job worker is to send the fabric back, printed on the job work
--  order and on the fabric issue challan. Optional on both; existing rows
--  stay null.
-- ===========================================================================

ALTER TABLE "dye_issues" ADD COLUMN "delivery_date" DATE;

ALTER TABLE "fabric_issues" ADD COLUMN "delivery_date" DATE;
