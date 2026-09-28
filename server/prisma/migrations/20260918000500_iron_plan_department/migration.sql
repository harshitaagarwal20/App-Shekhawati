-- ===========================================================================
--  IRON IS A PLANNING DEPARTMENT
--
--  The office plans ironing (pressing after stitching) the same way it plans
--  the other floors. Like PACKING, this is a plan only - there is no ironing
--  execution module. Adding an enum value leaves every existing row untouched.
-- ===========================================================================

ALTER TYPE "PlanDepartment" ADD VALUE IF NOT EXISTS 'IRON' AFTER 'STITCHING';
