/**
 * Scope guard.
 *
 * The application ENDS at Cutting Issue. This script fails the build if any
 * model, table, enum or field in schema.prisma refers to a module that is
 * explicitly out of scope, so a later phase cannot quietly grow past the
 * agreed boundary.
 *
 *     node prisma/verify-scope.js
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, 'schema.prisma'), 'utf8');

/**
 * Out-of-scope modules, as listed in the master prompt. Each entry is matched
 * against model names, @@map table names and field names - not against prose
 * in comments, which is allowed to explain why something is absent.
 */
const FORBIDDEN = [
  { module: 'Stitching Record', patterns: [/stitching_?record/i, /StitchingRecord/] },
  { module: 'Hourly Monitoring', patterns: [/hourly_?monitor/i, /HourlyMonitor/] },
  { module: 'QC Size', patterns: [/qc_?size/i, /QcSize/] },
  { module: 'QC Defects', patterns: [/qc_?defect/i, /QcDefect/] },
  { module: 'Internal Quality Check', patterns: [/internal_?quality/i, /InternalQuality/] },
  { module: 'Internal / Final Checker Report', patterns: [/checker_?report/i, /CheckerReport/] },
  { module: 'Finished Checker', patterns: [/finished_?checker/i, /FinishedChecker/] },
  { module: 'External Secondary Checking', patterns: [/external_?secondary/i, /ExternalSecondary/] },
  { module: 'Alter Report', patterns: [/alter_?report/i, /AlterReport/] },
  { module: 'Spot Rectification-Scrap', patterns: [/spot_?rectification/i, /SpotRectification/] },
  { module: 'Rejected', patterns: [/model\s+Rejected\b/, /@@map\("rejected"\)/] },
  { module: 'Packing', patterns: [/model\s+Packing\b/, /@@map\("packings?"\)/] },
  { module: 'Needle Checking', patterns: [/needle_?check/i, /NeedleCheck/] },
  { module: 'Dispatch', patterns: [/model\s+Dispatch\b/, /@@map\("dispatch(es)?"\)/, /dispatch_/i] },
  { module: 'Reconciliation Report', patterns: [/reconciliation/i, /Reconciliation/] },
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
process.stdout.write(`  pipeline ends at : CuttingIssue${models.includes('CuttingIssue') ? ' (present)' : ' (MISSING!)'}\n`);

if (!models.includes('CuttingIssue')) {
  process.stdout.write('\nx CuttingIssue model is missing - the pipeline has no terminal stage.\n\n');
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
