/**
 * Which tables are audited, and what a person calls them.
 *
 * ---------------------------------------------------------------------------
 *  WHY A LIST RATHER THAN "EVERYTHING"
 *
 *  Auditing every table would bury the useful entries. Three kinds of table are
 *  deliberately absent:
 *
 *    sessions, doc_sequences   Machinery. A session row changes on every
 *                              request and a sequence on every document; both
 *                              are noise, and neither is a business fact
 *                              anybody would query the trail for.
 *
 *    stock_ledger              Already an audit log. It is append-only and
 *                              carries its own actor, reference and timestamp;
 *                              auditing it would store every movement twice.
 *
 *    audit_logs                Itself. Auditing the audit log recurses.
 *
 *  Everything a person can change through a screen is here.
 *
 *  This module has no imports on purpose: both the Prisma client (which writes
 *  the entries) and the audit service (which reads them) need it, and a shared
 *  leaf module keeps those two from importing each other.
 * ---------------------------------------------------------------------------
 */

/** table name -> { label, route(id) }. `route` may return null where the record has no screen. */
export const AUDITED = {
  buyer_orders: { label: 'Buyer order', route: (id) => `/orders/${id}` },
  plannings: { label: 'Plan', route: (id) => `/planning/${id}` },
  vendor_quotations: { label: 'Quotation', route: (id) => `/quotations/${id}` },
  purchase_orders: { label: 'Purchase order', route: (id) => `/purchase-orders/${id}` },
  gate_passes: { label: 'Gate pass', route: (id) => `/gate-passes/${id}` },
  grns: { label: 'GRN', route: (id) => `/grns/${id}` },
  // F-04. Audited for the same reason the receipt is, and rather more so: this
  // is the document that takes stock back out, and "who changed the reason
  // between raising it and signing it" is a question somebody will ask.
  grn_reversals: { label: 'GRN reversal', route: (id) => `/grn-reversals/${id}` },
  fabric_rolls: { label: 'Fabric roll', route: (id) => `/inventory/rolls/${id}` },
  inventory_items: { label: 'Stock item', route: () => '/inventory/stock' },
  fabric_issues: { label: 'Fabric issue', route: (id) => `/fabric-issues/${id}` },
  dye_issues: { label: 'Job work', route: (id) => `/job-works/${id}` },
  dyeing_receipts: { label: 'Job work return', route: () => null },
  fabric_scrutinies: { label: 'Fabric scrutiny', route: (id) => `/scrutinies/${id}` },
  plan_approvals: { label: 'Plan approval', route: (id) => `/plan-approvals/${id}` },
  cutting_issues: { label: 'Cutting issue', route: (id) => `/cutting-issues/${id}` },
  // After cutting. Each register is one screen with its rows edited in place,
  // so the trail links to the register rather than to a detail page.
  stitching_records: { label: 'Stitching record', route: () => '/stitching-records' },
  hourly_monitorings: { label: 'Hourly monitoring', route: () => '/hourly-monitoring' },
  qc_size_records: { label: 'QC size record', route: () => '/qc-size-records' },
  qc_defect_records: { label: 'QC defect record', route: () => '/qc-defect-records' },
  internal_quality_checks: { label: 'Internal quality check', route: () => '/internal-quality-checks' },
  final_checker_reports: { label: 'Final checker report', route: () => '/final-checker-reports' },
  finished_checker_records: { label: 'Finished checker record', route: () => '/finished-checker-records' },
  external_secondary_checks: { label: 'External secondary check', route: () => '/external-secondary-checks' },
  alter_reports: { label: 'Alter report', route: () => '/alter-reports' },
  spot_rectifications: { label: 'Spot rectification', route: () => '/spot-rectifications' },
  rejected_records: { label: 'Rejected record', route: () => '/rejected-records' },
  reconciliation_reports: { label: 'Reconciliation report', route: () => '/reconciliation-reports' },
  excess_rules: { label: 'Excess rule', route: () => '/masters/excess-rules' },
  excess_approvals: { label: 'Excess authorisation', route: () => '/approvals' },
  buyers: { label: 'Buyer', route: () => '/masters/buyers' },
  vendors: { label: 'Vendor', route: () => '/masters/vendors' },
  employees: { label: 'Employee', route: () => '/masters/employees' },
  styles: { label: 'Style', route: () => '/masters/styles' },
  master_lists: { label: 'Master list', route: () => '/masters/list-master' },
  master_list_values: { label: 'Master list value', route: () => '/masters/list-master' },
  users: { label: 'User', route: () => '/admin/users' },
  roles: { label: 'Role', route: () => '/admin/roles' },
  user_roles: { label: 'User role assignment', route: () => '/admin/users' },
  role_permissions: { label: 'Role permission', route: () => '/admin/roles' },
};

/**
 * Columns never written to the trail, whatever table they appear on.
 *
 * A password hash in an audit log is a password hash in one more place. The
 * refresh-token hash and the reset token are the same problem: recording the
 * old value of a secret defeats the point of rotating it.
 */
export const REDACTED = new Set([
  'passwordHash',
  'password_hash',
  'refreshTokenHash',
  'refresh_token_hash',
  'resetToken',
  'reset_token',
  'tokenHash',
  'token_hash',
]);

/**
 * Columns that change on every write by definition and would drown the one
 * field somebody actually edited.
 */
export const IGNORED_FIELDS = new Set(['updatedAt', 'updatedById', 'createdAt', 'createdById']);

export const isAudited = (tableName) => Object.hasOwn(AUDITED, tableName);
export const labelFor = (tableName) => AUDITED[tableName]?.label ?? tableName;
export const routeFor = (tableName, id) => AUDITED[tableName]?.route?.(id) ?? null;

export default AUDITED;
