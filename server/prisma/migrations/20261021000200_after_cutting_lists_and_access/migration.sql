-- ===========================================================================
--  AFTER CUTTING - the dropdowns, the permissions and the stitching desk
-- ===========================================================================
--
--  Three things the registers in 20261021000100 need before anybody can use
--  them on a live database, where the seeder never runs:
--
--    1. The six Master Lists their dropdowns read, verbatim from the
--       workbook's "Master Lists" sheet. DefectType, StitchingUnit and
--       AuthorisedBy already exist and are reused as they are.
--    2. VIEW / CREATE / EDIT / DELETE / EXPORT for each of the twelve
--       registers. None is approvable: "Authorised By" and "Status" on the
--       sheets are recorded, not routed through the approval engine.
--    3. The STITCHING role - the workbook's "Stitching Dept (Supervisor)",
--       which keeps the stitching record, hourly monitoring and alter report.
--
--  Every statement is idempotent, so a database that already carries a list,
--  a permission or the role keeps it and only gains what it lacks.
-- ===========================================================================

-- ---- 1. MASTER LISTS -----------------------------------------------------

INSERT INTO "master_lists" ("id", "code", "name", "description", "is_system", "created_at", "updated_at")
SELECT gen_random_uuid(), 'Operation', 'Operation', 'QC Size - Operation (L_Operation)', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 WHERE NOT EXISTS (SELECT 1 FROM "master_lists" WHERE "code" = 'Operation');

INSERT INTO "master_list_values" ("id", "list_id", "value", "code", "sort_order", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), l."id", t.value, t.value, t.ord * 10, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "master_lists" l
 CROSS JOIN (VALUES
   ('Body Stitch', 1),
   ('Handle Attach', 2),
   ('Hemming', 3),
   ('Label Attach', 4),
   ('Lupi Stitch', 5),
   ('Gusset Stitch', 6),
   ('Final Trim', 7)
 ) AS t(value, ord)
 WHERE l."code" = 'Operation'
   AND NOT EXISTS (
     SELECT 1 FROM "master_list_values" e WHERE e."list_id" = l."id" AND e."value" = t.value
   );

INSERT INTO "master_lists" ("id", "code", "name", "description", "is_system", "created_at", "updated_at")
SELECT gen_random_uuid(), 'InformTo', 'Inform To', 'QC Size / QC Defects - Inform To (L_InformTo)', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 WHERE NOT EXISTS (SELECT 1 FROM "master_lists" WHERE "code" = 'InformTo');

INSERT INTO "master_list_values" ("id", "list_id", "value", "code", "sort_order", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), l."id", t.value, t.value, t.ord * 10, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "master_lists" l
 CROSS JOIN (VALUES
   ('Unit Incharge', 1),
   ('QC Head', 2),
   ('Supervisor', 3),
   ('Production Manager', 4),
   ('Dinesh Sir', 5)
 ) AS t(value, ord)
 WHERE l."code" = 'InformTo'
   AND NOT EXISTS (
     SELECT 1 FROM "master_list_values" e WHERE e."list_id" = l."id" AND e."value" = t.value
   );

INSERT INTO "master_lists" ("id", "code", "name", "description", "is_system", "created_at", "updated_at")
SELECT gen_random_uuid(), 'StatusQC', 'Status QC', 'Internal Quality Check - Status (L_StatusQC)', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 WHERE NOT EXISTS (SELECT 1 FROM "master_lists" WHERE "code" = 'StatusQC');

INSERT INTO "master_list_values" ("id", "list_id", "value", "code", "sort_order", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), l."id", t.value, t.value, t.ord * 10, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "master_lists" l
 CROSS JOIN (VALUES
   ('Approved', 1),
   ('Rejected', 2),
   ('Alteration', 3)
 ) AS t(value, ord)
 WHERE l."code" = 'StatusQC'
   AND NOT EXISTS (
     SELECT 1 FROM "master_list_values" e WHERE e."list_id" = l."id" AND e."value" = t.value
   );

INSERT INTO "master_lists" ("id", "code", "name", "description", "is_system", "created_at", "updated_at")
SELECT gen_random_uuid(), 'RejectReason', 'Reject Reason', 'Rejected - Reason of Defects (L_RejectReason)', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 WHERE NOT EXISTS (SELECT 1 FROM "master_lists" WHERE "code" = 'RejectReason');

INSERT INTO "master_list_values" ("id", "list_id", "value", "code", "sort_order", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), l."id", t.value, t.value, t.ord * 10, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "master_lists" l
 CROSS JOIN (VALUES
   ('Fabric', 1),
   ('Handle Out', 2),
   ('Stitching', 3),
   ('Hard Stain', 4),
   ('Dye', 5)
 ) AS t(value, ord)
 WHERE l."code" = 'RejectReason'
   AND NOT EXISTS (
     SELECT 1 FROM "master_list_values" e WHERE e."list_id" = l."id" AND e."value" = t.value
   );

INSERT INTO "master_lists" ("id", "code", "name", "description", "is_system", "created_at", "updated_at")
SELECT gen_random_uuid(), 'InspDefect26', 'Inspection Defect', 'External Secondary Checking - Particulars, the 26 inspection defects (L_InspDefect26)', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 WHERE NOT EXISTS (SELECT 1 FROM "master_lists" WHERE "code" = 'InspDefect26');

INSERT INTO "master_list_values" ("id", "list_id", "value", "code", "sort_order", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), l."id", t.value, t.value, t.ord * 10, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "master_lists" l
 CROSS JOIN (VALUES
   ('Stitch skipping', 1),
   ('Open stitch', 2),
   ('Sewing shifted / Uneven', 3),
   ('Sewing shifted / Gathering', 4),
   ('Over / Double stitch', 5),
   ('Yarn cutting / Uncut thread', 6),
   ('Blind-stitch defect / Open seam', 7),
   ('Pilling / Fly yarn', 8),
   ('Press', 9),
   ('Over / Doubling stitch', 10),
   ('Fabric no strength / Fabric fault', 11),
   ('Side stitch / Overlock', 12),
   ('Colour difference / Shade', 13),
   ('Size difference', 14),
   ('Breakage / Damage / Eyelet breakage', 15),
   ('Needle hole', 16),
   ('Thread breakage / Broken stitch', 17),
   ('Dirt / Spot', 18),
   ('Walking shade / Running shade', 19),
   ('Overlock tension', 20),
   ('Label mistake', 21),
   ('Handle placement', 22),
   ('Pressing mark', 23),
   ('Oil spot / Stain', 24),
   ('Chalk mark', 25),
   ('Fastener opening / Closing defect', 26)
 ) AS t(value, ord)
 WHERE l."code" = 'InspDefect26'
   AND NOT EXISTS (
     SELECT 1 FROM "master_list_values" e WHERE e."list_id" = l."id" AND e."value" = t.value
   );

INSERT INTO "master_lists" ("id", "code", "name", "description", "is_system", "created_at", "updated_at")
SELECT gen_random_uuid(), 'StatusRecon', 'Status Recon', 'Reconciliation Report - Status (L_StatusRecon)', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 WHERE NOT EXISTS (SELECT 1 FROM "master_lists" WHERE "code" = 'StatusRecon');

INSERT INTO "master_list_values" ("id", "list_id", "value", "code", "sort_order", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), l."id", t.value, t.value, t.ord * 10, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "master_lists" l
 CROSS JOIN (VALUES
   ('Matched', 1),
   ('Variance Found', 2)
 ) AS t(value, ord)
 WHERE l."code" = 'StatusRecon'
   AND NOT EXISTS (
     SELECT 1 FROM "master_list_values" e WHERE e."list_id" = l."id" AND e."value" = t.value
   );

-- ---- 2. PERMISSIONS ------------------------------------------------------

INSERT INTO "permissions" ("id", "code", "module", "action", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), v.code, v.module, v.action, v.description, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM (VALUES
    ('STITCHING_RECORD.VIEW', 'STITCHING_RECORD', 'VIEW', 'View stitching record'),
    ('STITCHING_RECORD.CREATE', 'STITCHING_RECORD', 'CREATE', 'Create stitching record'),
    ('STITCHING_RECORD.EDIT', 'STITCHING_RECORD', 'EDIT', 'Edit stitching record'),
    ('STITCHING_RECORD.DELETE', 'STITCHING_RECORD', 'DELETE', 'Delete stitching record'),
    ('STITCHING_RECORD.EXPORT', 'STITCHING_RECORD', 'EXPORT', 'Export stitching record'),
    ('HOURLY_MONITORING.VIEW', 'HOURLY_MONITORING', 'VIEW', 'View hourly monitoring'),
    ('HOURLY_MONITORING.CREATE', 'HOURLY_MONITORING', 'CREATE', 'Create hourly monitoring'),
    ('HOURLY_MONITORING.EDIT', 'HOURLY_MONITORING', 'EDIT', 'Edit hourly monitoring'),
    ('HOURLY_MONITORING.DELETE', 'HOURLY_MONITORING', 'DELETE', 'Delete hourly monitoring'),
    ('HOURLY_MONITORING.EXPORT', 'HOURLY_MONITORING', 'EXPORT', 'Export hourly monitoring'),
    ('QC_SIZE_RECORD.VIEW', 'QC_SIZE_RECORD', 'VIEW', 'View qc size record'),
    ('QC_SIZE_RECORD.CREATE', 'QC_SIZE_RECORD', 'CREATE', 'Create qc size record'),
    ('QC_SIZE_RECORD.EDIT', 'QC_SIZE_RECORD', 'EDIT', 'Edit qc size record'),
    ('QC_SIZE_RECORD.DELETE', 'QC_SIZE_RECORD', 'DELETE', 'Delete qc size record'),
    ('QC_SIZE_RECORD.EXPORT', 'QC_SIZE_RECORD', 'EXPORT', 'Export qc size record'),
    ('QC_DEFECT_RECORD.VIEW', 'QC_DEFECT_RECORD', 'VIEW', 'View qc defect record'),
    ('QC_DEFECT_RECORD.CREATE', 'QC_DEFECT_RECORD', 'CREATE', 'Create qc defect record'),
    ('QC_DEFECT_RECORD.EDIT', 'QC_DEFECT_RECORD', 'EDIT', 'Edit qc defect record'),
    ('QC_DEFECT_RECORD.DELETE', 'QC_DEFECT_RECORD', 'DELETE', 'Delete qc defect record'),
    ('QC_DEFECT_RECORD.EXPORT', 'QC_DEFECT_RECORD', 'EXPORT', 'Export qc defect record'),
    ('INTERNAL_QUALITY_CHECK.VIEW', 'INTERNAL_QUALITY_CHECK', 'VIEW', 'View internal quality check'),
    ('INTERNAL_QUALITY_CHECK.CREATE', 'INTERNAL_QUALITY_CHECK', 'CREATE', 'Create internal quality check'),
    ('INTERNAL_QUALITY_CHECK.EDIT', 'INTERNAL_QUALITY_CHECK', 'EDIT', 'Edit internal quality check'),
    ('INTERNAL_QUALITY_CHECK.DELETE', 'INTERNAL_QUALITY_CHECK', 'DELETE', 'Delete internal quality check'),
    ('INTERNAL_QUALITY_CHECK.EXPORT', 'INTERNAL_QUALITY_CHECK', 'EXPORT', 'Export internal quality check'),
    ('FINAL_CHECKER_REPORT.VIEW', 'FINAL_CHECKER_REPORT', 'VIEW', 'View final checker report'),
    ('FINAL_CHECKER_REPORT.CREATE', 'FINAL_CHECKER_REPORT', 'CREATE', 'Create final checker report'),
    ('FINAL_CHECKER_REPORT.EDIT', 'FINAL_CHECKER_REPORT', 'EDIT', 'Edit final checker report'),
    ('FINAL_CHECKER_REPORT.DELETE', 'FINAL_CHECKER_REPORT', 'DELETE', 'Delete final checker report'),
    ('FINAL_CHECKER_REPORT.EXPORT', 'FINAL_CHECKER_REPORT', 'EXPORT', 'Export final checker report'),
    ('FINISHED_CHECKER.VIEW', 'FINISHED_CHECKER', 'VIEW', 'View finished checker'),
    ('FINISHED_CHECKER.CREATE', 'FINISHED_CHECKER', 'CREATE', 'Create finished checker'),
    ('FINISHED_CHECKER.EDIT', 'FINISHED_CHECKER', 'EDIT', 'Edit finished checker'),
    ('FINISHED_CHECKER.DELETE', 'FINISHED_CHECKER', 'DELETE', 'Delete finished checker'),
    ('FINISHED_CHECKER.EXPORT', 'FINISHED_CHECKER', 'EXPORT', 'Export finished checker'),
    ('EXTERNAL_SECONDARY_CHECK.VIEW', 'EXTERNAL_SECONDARY_CHECK', 'VIEW', 'View external secondary check'),
    ('EXTERNAL_SECONDARY_CHECK.CREATE', 'EXTERNAL_SECONDARY_CHECK', 'CREATE', 'Create external secondary check'),
    ('EXTERNAL_SECONDARY_CHECK.EDIT', 'EXTERNAL_SECONDARY_CHECK', 'EDIT', 'Edit external secondary check'),
    ('EXTERNAL_SECONDARY_CHECK.DELETE', 'EXTERNAL_SECONDARY_CHECK', 'DELETE', 'Delete external secondary check'),
    ('EXTERNAL_SECONDARY_CHECK.EXPORT', 'EXTERNAL_SECONDARY_CHECK', 'EXPORT', 'Export external secondary check'),
    ('ALTER_REPORT.VIEW', 'ALTER_REPORT', 'VIEW', 'View alter report'),
    ('ALTER_REPORT.CREATE', 'ALTER_REPORT', 'CREATE', 'Create alter report'),
    ('ALTER_REPORT.EDIT', 'ALTER_REPORT', 'EDIT', 'Edit alter report'),
    ('ALTER_REPORT.DELETE', 'ALTER_REPORT', 'DELETE', 'Delete alter report'),
    ('ALTER_REPORT.EXPORT', 'ALTER_REPORT', 'EXPORT', 'Export alter report'),
    ('SPOT_RECTIFICATION.VIEW', 'SPOT_RECTIFICATION', 'VIEW', 'View spot rectification'),
    ('SPOT_RECTIFICATION.CREATE', 'SPOT_RECTIFICATION', 'CREATE', 'Create spot rectification'),
    ('SPOT_RECTIFICATION.EDIT', 'SPOT_RECTIFICATION', 'EDIT', 'Edit spot rectification'),
    ('SPOT_RECTIFICATION.DELETE', 'SPOT_RECTIFICATION', 'DELETE', 'Delete spot rectification'),
    ('SPOT_RECTIFICATION.EXPORT', 'SPOT_RECTIFICATION', 'EXPORT', 'Export spot rectification'),
    ('REJECTED_RECORD.VIEW', 'REJECTED_RECORD', 'VIEW', 'View rejected record'),
    ('REJECTED_RECORD.CREATE', 'REJECTED_RECORD', 'CREATE', 'Create rejected record'),
    ('REJECTED_RECORD.EDIT', 'REJECTED_RECORD', 'EDIT', 'Edit rejected record'),
    ('REJECTED_RECORD.DELETE', 'REJECTED_RECORD', 'DELETE', 'Delete rejected record'),
    ('REJECTED_RECORD.EXPORT', 'REJECTED_RECORD', 'EXPORT', 'Export rejected record'),
    ('RECONCILIATION_REPORT.VIEW', 'RECONCILIATION_REPORT', 'VIEW', 'View reconciliation report'),
    ('RECONCILIATION_REPORT.CREATE', 'RECONCILIATION_REPORT', 'CREATE', 'Create reconciliation report'),
    ('RECONCILIATION_REPORT.EDIT', 'RECONCILIATION_REPORT', 'EDIT', 'Edit reconciliation report'),
    ('RECONCILIATION_REPORT.DELETE', 'RECONCILIATION_REPORT', 'DELETE', 'Delete reconciliation report'),
    ('RECONCILIATION_REPORT.EXPORT', 'RECONCILIATION_REPORT', 'EXPORT', 'Export reconciliation report')
  ) AS v(code, module, action, description)
 WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."code" = v.code);

-- ---- 3. THE STITCHING ROLE ------------------------------------------------

INSERT INTO "roles" ("id", "code", "name", "description", "is_system", "created_at", "updated_at")
SELECT gen_random_uuid(), 'STITCHING', 'Stitching Supervisor',
       'The stitching units. Keeps the stitching record, the hourly monitoring and the alter report, and reads the QC registers that send work back to the unit.',
       TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 WHERE NOT EXISTS (SELECT 1 FROM "roles" WHERE "code" = 'STITCHING');

-- ---- 4. WHO HOLDS WHAT ----------------------------------------------------
--
--  The same grants the seeder derives from seed/data/rbac.js:
--    ADMIN           everything
--    DIRECTOR        view and export everything
--    QC              owns the eight QC registers, reads stitching and alter
--    MERCHANDISING   owns the reconciliation (Planning Dept (GM)), reads the rest
--    STITCHING       owns stitching, hourly monitoring and alter, reads QC
--
--  A role that does not exist on this database is skipped, not created.

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT r."id", p."id", CURRENT_TIMESTAMP
  FROM (VALUES
    ('ADMIN', 'STITCHING_RECORD.VIEW'),
    ('ADMIN', 'STITCHING_RECORD.CREATE'),
    ('ADMIN', 'STITCHING_RECORD.EDIT'),
    ('ADMIN', 'STITCHING_RECORD.DELETE'),
    ('ADMIN', 'STITCHING_RECORD.EXPORT'),
    ('ADMIN', 'HOURLY_MONITORING.VIEW'),
    ('ADMIN', 'HOURLY_MONITORING.CREATE'),
    ('ADMIN', 'HOURLY_MONITORING.EDIT'),
    ('ADMIN', 'HOURLY_MONITORING.DELETE'),
    ('ADMIN', 'HOURLY_MONITORING.EXPORT'),
    ('ADMIN', 'QC_SIZE_RECORD.VIEW'),
    ('ADMIN', 'QC_SIZE_RECORD.CREATE'),
    ('ADMIN', 'QC_SIZE_RECORD.EDIT'),
    ('ADMIN', 'QC_SIZE_RECORD.DELETE'),
    ('ADMIN', 'QC_SIZE_RECORD.EXPORT'),
    ('ADMIN', 'QC_DEFECT_RECORD.VIEW'),
    ('ADMIN', 'QC_DEFECT_RECORD.CREATE'),
    ('ADMIN', 'QC_DEFECT_RECORD.EDIT'),
    ('ADMIN', 'QC_DEFECT_RECORD.DELETE'),
    ('ADMIN', 'QC_DEFECT_RECORD.EXPORT'),
    ('ADMIN', 'INTERNAL_QUALITY_CHECK.VIEW'),
    ('ADMIN', 'INTERNAL_QUALITY_CHECK.CREATE'),
    ('ADMIN', 'INTERNAL_QUALITY_CHECK.EDIT'),
    ('ADMIN', 'INTERNAL_QUALITY_CHECK.DELETE'),
    ('ADMIN', 'INTERNAL_QUALITY_CHECK.EXPORT'),
    ('ADMIN', 'FINAL_CHECKER_REPORT.VIEW'),
    ('ADMIN', 'FINAL_CHECKER_REPORT.CREATE'),
    ('ADMIN', 'FINAL_CHECKER_REPORT.EDIT'),
    ('ADMIN', 'FINAL_CHECKER_REPORT.DELETE'),
    ('ADMIN', 'FINAL_CHECKER_REPORT.EXPORT'),
    ('ADMIN', 'FINISHED_CHECKER.VIEW'),
    ('ADMIN', 'FINISHED_CHECKER.CREATE'),
    ('ADMIN', 'FINISHED_CHECKER.EDIT'),
    ('ADMIN', 'FINISHED_CHECKER.DELETE'),
    ('ADMIN', 'FINISHED_CHECKER.EXPORT'),
    ('ADMIN', 'EXTERNAL_SECONDARY_CHECK.VIEW'),
    ('ADMIN', 'EXTERNAL_SECONDARY_CHECK.CREATE'),
    ('ADMIN', 'EXTERNAL_SECONDARY_CHECK.EDIT'),
    ('ADMIN', 'EXTERNAL_SECONDARY_CHECK.DELETE'),
    ('ADMIN', 'EXTERNAL_SECONDARY_CHECK.EXPORT'),
    ('ADMIN', 'ALTER_REPORT.VIEW'),
    ('ADMIN', 'ALTER_REPORT.CREATE'),
    ('ADMIN', 'ALTER_REPORT.EDIT'),
    ('ADMIN', 'ALTER_REPORT.DELETE'),
    ('ADMIN', 'ALTER_REPORT.EXPORT'),
    ('ADMIN', 'SPOT_RECTIFICATION.VIEW'),
    ('ADMIN', 'SPOT_RECTIFICATION.CREATE'),
    ('ADMIN', 'SPOT_RECTIFICATION.EDIT'),
    ('ADMIN', 'SPOT_RECTIFICATION.DELETE'),
    ('ADMIN', 'SPOT_RECTIFICATION.EXPORT'),
    ('ADMIN', 'REJECTED_RECORD.VIEW'),
    ('ADMIN', 'REJECTED_RECORD.CREATE'),
    ('ADMIN', 'REJECTED_RECORD.EDIT'),
    ('ADMIN', 'REJECTED_RECORD.DELETE'),
    ('ADMIN', 'REJECTED_RECORD.EXPORT'),
    ('ADMIN', 'RECONCILIATION_REPORT.VIEW'),
    ('ADMIN', 'RECONCILIATION_REPORT.CREATE'),
    ('ADMIN', 'RECONCILIATION_REPORT.EDIT'),
    ('ADMIN', 'RECONCILIATION_REPORT.DELETE'),
    ('ADMIN', 'RECONCILIATION_REPORT.EXPORT'),
    ('DIRECTOR', 'STITCHING_RECORD.VIEW'),
    ('DIRECTOR', 'STITCHING_RECORD.EXPORT'),
    ('DIRECTOR', 'HOURLY_MONITORING.VIEW'),
    ('DIRECTOR', 'HOURLY_MONITORING.EXPORT'),
    ('DIRECTOR', 'QC_SIZE_RECORD.VIEW'),
    ('DIRECTOR', 'QC_SIZE_RECORD.EXPORT'),
    ('DIRECTOR', 'QC_DEFECT_RECORD.VIEW'),
    ('DIRECTOR', 'QC_DEFECT_RECORD.EXPORT'),
    ('DIRECTOR', 'INTERNAL_QUALITY_CHECK.VIEW'),
    ('DIRECTOR', 'INTERNAL_QUALITY_CHECK.EXPORT'),
    ('DIRECTOR', 'FINAL_CHECKER_REPORT.VIEW'),
    ('DIRECTOR', 'FINAL_CHECKER_REPORT.EXPORT'),
    ('DIRECTOR', 'FINISHED_CHECKER.VIEW'),
    ('DIRECTOR', 'FINISHED_CHECKER.EXPORT'),
    ('DIRECTOR', 'EXTERNAL_SECONDARY_CHECK.VIEW'),
    ('DIRECTOR', 'EXTERNAL_SECONDARY_CHECK.EXPORT'),
    ('DIRECTOR', 'ALTER_REPORT.VIEW'),
    ('DIRECTOR', 'ALTER_REPORT.EXPORT'),
    ('DIRECTOR', 'SPOT_RECTIFICATION.VIEW'),
    ('DIRECTOR', 'SPOT_RECTIFICATION.EXPORT'),
    ('DIRECTOR', 'REJECTED_RECORD.VIEW'),
    ('DIRECTOR', 'REJECTED_RECORD.EXPORT'),
    ('DIRECTOR', 'RECONCILIATION_REPORT.VIEW'),
    ('DIRECTOR', 'RECONCILIATION_REPORT.EXPORT'),
    ('QC', 'QC_SIZE_RECORD.VIEW'),
    ('QC', 'QC_SIZE_RECORD.CREATE'),
    ('QC', 'QC_SIZE_RECORD.EDIT'),
    ('QC', 'QC_SIZE_RECORD.EXPORT'),
    ('QC', 'QC_DEFECT_RECORD.VIEW'),
    ('QC', 'QC_DEFECT_RECORD.CREATE'),
    ('QC', 'QC_DEFECT_RECORD.EDIT'),
    ('QC', 'QC_DEFECT_RECORD.EXPORT'),
    ('QC', 'INTERNAL_QUALITY_CHECK.VIEW'),
    ('QC', 'INTERNAL_QUALITY_CHECK.CREATE'),
    ('QC', 'INTERNAL_QUALITY_CHECK.EDIT'),
    ('QC', 'INTERNAL_QUALITY_CHECK.EXPORT'),
    ('QC', 'FINAL_CHECKER_REPORT.VIEW'),
    ('QC', 'FINAL_CHECKER_REPORT.CREATE'),
    ('QC', 'FINAL_CHECKER_REPORT.EDIT'),
    ('QC', 'FINAL_CHECKER_REPORT.EXPORT'),
    ('QC', 'FINISHED_CHECKER.VIEW'),
    ('QC', 'FINISHED_CHECKER.CREATE'),
    ('QC', 'FINISHED_CHECKER.EDIT'),
    ('QC', 'FINISHED_CHECKER.EXPORT'),
    ('QC', 'EXTERNAL_SECONDARY_CHECK.VIEW'),
    ('QC', 'EXTERNAL_SECONDARY_CHECK.CREATE'),
    ('QC', 'EXTERNAL_SECONDARY_CHECK.EDIT'),
    ('QC', 'EXTERNAL_SECONDARY_CHECK.EXPORT'),
    ('QC', 'SPOT_RECTIFICATION.VIEW'),
    ('QC', 'SPOT_RECTIFICATION.CREATE'),
    ('QC', 'SPOT_RECTIFICATION.EDIT'),
    ('QC', 'SPOT_RECTIFICATION.EXPORT'),
    ('QC', 'REJECTED_RECORD.VIEW'),
    ('QC', 'REJECTED_RECORD.CREATE'),
    ('QC', 'REJECTED_RECORD.EDIT'),
    ('QC', 'REJECTED_RECORD.EXPORT'),
    ('QC', 'STITCHING_RECORD.VIEW'),
    ('QC', 'ALTER_REPORT.VIEW'),
    ('QC', 'RECONCILIATION_REPORT.VIEW'),
    ('MERCHANDISING', 'RECONCILIATION_REPORT.VIEW'),
    ('MERCHANDISING', 'RECONCILIATION_REPORT.CREATE'),
    ('MERCHANDISING', 'RECONCILIATION_REPORT.EDIT'),
    ('MERCHANDISING', 'RECONCILIATION_REPORT.EXPORT'),
    ('MERCHANDISING', 'STITCHING_RECORD.VIEW'),
    ('MERCHANDISING', 'HOURLY_MONITORING.VIEW'),
    ('MERCHANDISING', 'QC_SIZE_RECORD.VIEW'),
    ('MERCHANDISING', 'QC_DEFECT_RECORD.VIEW'),
    ('MERCHANDISING', 'INTERNAL_QUALITY_CHECK.VIEW'),
    ('MERCHANDISING', 'FINAL_CHECKER_REPORT.VIEW'),
    ('MERCHANDISING', 'FINISHED_CHECKER.VIEW'),
    ('MERCHANDISING', 'EXTERNAL_SECONDARY_CHECK.VIEW'),
    ('MERCHANDISING', 'ALTER_REPORT.VIEW'),
    ('MERCHANDISING', 'SPOT_RECTIFICATION.VIEW'),
    ('MERCHANDISING', 'REJECTED_RECORD.VIEW'),
    ('STITCHING', 'STITCHING_RECORD.VIEW'),
    ('STITCHING', 'STITCHING_RECORD.CREATE'),
    ('STITCHING', 'STITCHING_RECORD.EDIT'),
    ('STITCHING', 'STITCHING_RECORD.EXPORT'),
    ('STITCHING', 'HOURLY_MONITORING.VIEW'),
    ('STITCHING', 'HOURLY_MONITORING.CREATE'),
    ('STITCHING', 'HOURLY_MONITORING.EDIT'),
    ('STITCHING', 'HOURLY_MONITORING.EXPORT'),
    ('STITCHING', 'ALTER_REPORT.VIEW'),
    ('STITCHING', 'ALTER_REPORT.CREATE'),
    ('STITCHING', 'ALTER_REPORT.EDIT'),
    ('STITCHING', 'ALTER_REPORT.EXPORT'),
    ('STITCHING', 'QC_SIZE_RECORD.VIEW'),
    ('STITCHING', 'QC_DEFECT_RECORD.VIEW'),
    ('STITCHING', 'INTERNAL_QUALITY_CHECK.VIEW'),
    ('STITCHING', 'CUTTING_ISSUE.VIEW'),
    ('STITCHING', 'EMPLOYEE.VIEW'),
    ('STITCHING', 'BUYER_ORDER.VIEW'),
    ('STITCHING', 'MASTER_LIST.VIEW'),
    ('STITCHING', 'BUYER.VIEW'),
    ('STITCHING', 'STYLE.VIEW'),
    ('STITCHING', 'REPORT.VIEW'),
    ('QC', 'CUTTING_ISSUE.VIEW')
  ) AS g(role_code, permission_code)
  JOIN "roles" r ON r."code" = g.role_code
  JOIN "permissions" p ON p."code" = g.permission_code
 WHERE NOT EXISTS (
   SELECT 1 FROM "role_permissions" x WHERE x."role_id" = r."id" AND x."permission_id" = p."id"
 );
