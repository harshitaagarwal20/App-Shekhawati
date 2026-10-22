/**
 * Scope guard.
 *
 * The application ends at the Reconciliation Report (Phase 5), after the
 * final QC sheets and Spot Rectification-Scrap; before them come External QC
 * and the Alteration Unit (Phase 4), with the Rejected Register they write,
 * and Inline QC (Phase 3) beside stitching, which carries the workbook's QC
 * Size and QC Defects sheets. Only Packing, Needle Checking and Dispatch are
 * still out. This script fails the build if any
 * model, table, enum or field in schema.prisma refers to a module that is
 * still out of scope, so a later phase cannot quietly grow past the agreed
 * boundary.
 *
 * Opening the next phase is a deliberate edit to this file: move its module
 * off FORBIDDEN and onto DELIVERED, in the same commit as its tables.
 *
 *     node prisma/verify-scope.js
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, 'schema.prisma'), 'utf8');

/**
 * Modules opened since the original Masters -> Cutting Issue boundary, and the
 * model each one must be present as. A delivered module whose model is
 * missing is as much a failure as a forbidden one that appears.
 */
const DELIVERED = [
  { module: 'Stitching Record', phase: 'Production Phase 2', model: 'StitchingRecord' },
  { module: 'Hourly Monitoring', phase: 'Production Phase 2', model: 'HourlyMonitoringEntry' },
  { module: 'Ironing', phase: 'Ironing', model: 'IroningEntry' },
  // One register, two check types - see InlineQcEntry in schema.prisma.
  { module: 'QC Size', phase: 'Phase 3', model: 'InlineQcEntry' },
  { module: 'QC Defects', phase: 'Phase 3', model: 'InlineQcDefect' },
  { module: 'External Secondary Checking', phase: 'Phase 4', model: 'ExternalQcEntry' },
  { module: 'Alter Report (Alteration Unit)', phase: 'Phase 4', model: 'AlterationEntry' },
  { module: 'Rejected', phase: 'Phase 4', model: 'RejectedRegisterEntry' },
  { module: 'Internal Quality Check', phase: 'Phase 5', model: 'InternalQualityCheck' },
  // The workbook's sheet. The Checker Report under Reports is a different
  // thing - a report over External QC's checker codes, with no table.
  { module: 'Internal / Final Checker Report', phase: 'Phase 5', model: 'FinalCheckerReport' },
  { module: 'Finished Checker', phase: 'Phase 5', model: 'FinishedCheckerRecord' },
  // The 26-line inspection grid, on the External QC entry it belongs to.
  { module: 'External Secondary Checking (inspection report)', phase: 'Phase 5', model: 'ExternalQcInspectionLine' },
  { module: 'Spot Rectification-Scrap', phase: 'Phase 5', model: 'SpotRectification' },
  { module: 'Reconciliation Report', phase: 'Phase 5', model: 'ReconciliationReport' },
];

/**
 * Out-of-scope modules, as listed in the master prompt, less those DELIVERED.
 * Each entry is matched against model names, @@map table names and field
 * names - not against prose in comments, which is allowed to explain why
 * something is absent.
 */
const FORBIDDEN = [
  { module: 'Packing', patterns: [/model\s+Packing\b/, /@@map\("packings?"\)/] },
  { module: 'Needle Checking', patterns: [/needle_?check/i, /NeedleCheck/] },
  { module: 'Dispatch', patterns: [/model\s+Dispatch\b/, /@@map\("dispatch(es)?"\)/, /dispatch_/i] },
];

/**
 * C7 - THE ALLOWLIST, AND WHY IT HAS TO EXIST.
 *
 * Three of the FORBIDDEN patterns above are word-based, and three legitimate
 * things in this schema contain those words:
 *
 *   PlanDepartment.STITCHING / .SHIPPING   the Planning sheet's own column,
 *                                          present since Phase 0
 *   PlanType.STITCHING / .SHIPPING         C7. A PLAN is a sheet of paper the
 *                                          production office signs before work
 *                                          starts. It is not the work.
 *   PlanApprovalLine.planType              the column those values live in
 *
 * NONE of them is an implementation of stitching execution or of dispatch.
 * There is no table that records a stitching operation, no hourly monitoring,
 * no packing list, no dispatch note, and no route or service that produces
 * one. The guard's job is to catch a MODULE creeping in, and an enum value
 * naming a downstream department on a planning document is not that module.
 *
 * The distinction is worth stating precisely, because the cheap fix - loosening
 * the /dispatch_/i or /stitching_?record/i patterns - would blind the guard to
 * the very thing it exists to catch. Instead, each entry below names an EXACT
 * construct that is permitted, and anything else matching the same word still
 * fails.
 */
const ALLOWLIST = [
  {
    what: 'enum PlanDepartment',
    why:
      'Planning sheet column "Planning Department" - who owns a material plan. ' +
      'C14 adds PACKING: a packing PLAN is a signed sheet of paper, and this ' +
      'system still has no packing execution. The Packing pattern above matches ' +
      'a MODEL, not an enum value, so the guard is not weakened.',
    pattern: /enum\s+PlanDepartment\s*\{[^}]*\}/,
  },
  {
    what: 'enum PlanType',
    why: 'C7 plan types. A cutting / stitching / shipping PLAN, not its execution.',
    pattern: /enum\s+PlanType\s*\{[^}]*\}/,
  },
  {
    what: 'PlanApprovalLine.planType',
    why: 'C7 - the column the three plan types live in.',
    pattern: /planType\s+PlanType\s+@map\("plan_type"\)/,
  },
];

/**
 * The constructs the allowlist permits must actually still be there.
 *
 * An allowlist that silently permits something absent has stopped describing
 * the schema, and the next person to read it is misled about what the guard
 * is and is not checking.
 */
function verifyAllowlist(source) {
  return ALLOWLIST.filter((entry) => !entry.pattern.test(source)).map(
    (entry) => `${entry.what}: allowlisted but no longer present in the schema.`,
  );
}

// Strip comments - the schema is allowed to *mention* out-of-scope modules in
// order to document that they are deliberately absent.
// Split on \r?\n, not \n: the working copy is CRLF, and a trailing \r left on
// the line defeats the $ anchor below - which silently turned the comment
// strip into a no-op and flagged the very header prose these patterns exist
// to permit.
const code = schema
  .split(/\r?\n/)
  .map((line) => line.replace(/\/\/.*$/, '').replace(/\/\/\/.*$/, ''))
  .join('\n');

const violations = [];
for (const { module, patterns } of FORBIDDEN) {
  for (const p of patterns) {
    const m = code.match(p);
    if (m) violations.push(`${module}: schema contains "${m[0]}"`);
  }
}

const models = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);

const staleAllowlist = verifyAllowlist(schema);

process.stdout.write('\n=== SCOPE GUARD ===\n\n');
process.stdout.write(`  models in schema : ${models.length}\n`);
process.stdout.write(`  forbidden modules: ${FORBIDDEN.length}\n`);
process.stdout.write(`  allowlisted      : ${ALLOWLIST.length}\n`);
ALLOWLIST.forEach((a) => process.stdout.write(`    - ${a.what}  (${a.why})\n`));
process.stdout.write(`  cutting issue    : CuttingIssue${models.includes('CuttingIssue') ? ' (present)' : ' (MISSING!)'}\n`);
DELIVERED.forEach((d) =>
  process.stdout.write(
    `  delivered        : ${d.module} -> ${d.model}${models.includes(d.model) ? ' (present)' : ' (MISSING!)'}  [${d.phase}]\n`,
  ),
);

if (!models.includes('CuttingIssue')) {
  process.stdout.write('\nx CuttingIssue model is missing - stitching has nothing to draw cut pieces from.\n\n');
  process.exit(1);
}

const missing = DELIVERED.filter((d) => !models.includes(d.model));
if (missing.length) {
  missing.forEach((d) => process.stdout.write(`\nx ${d.module} is delivered but model ${d.model} is missing.\n`));
  process.stdout.write('\nSCOPE GUARD FAILED\n\n');
  process.exit(1);
}

if (staleAllowlist.length) {
  process.stdout.write(`\n--- ${staleAllowlist.length} STALE ALLOWLIST ENTRY(IES) ---\n`);
  staleAllowlist.forEach((v) => process.stdout.write(`  x ${v}\n`));
  process.stdout.write('\nSCOPE GUARD FAILED\n\n');
  process.exit(1);
}

if (violations.length) {
  process.stdout.write(`\n--- ${violations.length} SCOPE VIOLATION(S) ---\n`);
  violations.forEach((v) => process.stdout.write(`  x ${v}\n`));
  process.stdout.write('\nSCOPE GUARD FAILED\n\n');
  process.exit(1);
}

process.stdout.write('\nNo out-of-scope module found in the schema. SCOPE GUARD PASSED\n\n');
