/**
 * Roles and permissions.
 *
 * The seven roles below are the Phase 1 role list collapsed onto the people
 * who actually sit at the desks. Mapping from the workbook's "Role Acess - ..."
 * headers onto them:
 *
 *   Master Lists / Buyer / Vendor / Style Master ... HEAD_OFFICE  (+ ADMIN)
 *   Employee Master ................................ ADMIN
 *   Order .......................................... MERCHANDISING
 *   Planning_ / Planning ........................... MERCHANDISING
 *   Vendor Quotation-Approval ...................... STORE_MANAGER (approved by DIRECTOR)
 *   PO ............................................. STORE_MANAGER (approved by DIRECTOR)
 *   Gate Pass (raised at the gate) .................. SECURITY
 *   Gate Pass (allocated, cleared) / GRN /
 *     Dye issue / Dyeing Receipt ................... STORE_MANAGER
 *   Printing ....................................... STORE_MANAGER   <-- see note
 *   Fabric Issue ................................... STORE_MANAGER
 *   Fabric Scrutiny Report ......................... QC (decision by DIRECTOR)
 *   Plan Approval .................................. MERCHANDISING (approved by DIRECTOR)
 *   Cutting Issue .................................. STORE_MANAGER
 *
 * Three notes on that mapping:
 *
 *  - TWO PAIRS OF ROLES WERE MERGED, because in this business one person does
 *    both jobs and two logins for one person is a fiction the system should
 *    not carry. Merchandising absorbed PLANNING_OPERATOR and PLANNING_GM; STORE_MANAGER
 *    absorbed CUTTING_SUPERVISOR. Each merged role holds the union of the two
 *    old sets and nothing more - no permission was invented to make a merge
 *    tidy, and no approval authority moved.
 *
 *  - What did NOT merge is worth stating: raising a document stays apart from
 *    AUTHORISING it. PLAN_APPROVAL.APPROVE stays the Director's, as does every
 *    other *.APPROVE bar the two the GM's set carried in. Maker-checker is the
 *    separation that matters; job titles are not.
 *
 *  - The workbook has a "Printing Dept (Manager)" banner but the Phase 1 role
 *    list has no equivalent, and the question of where it should go was not
 *    answered. Printing is folded into STORE_MANAGER, which already owns the
 *    neighbouring job-work register (Dye issue covers both dyeing and printing
 *    job work). If Printing should get its own role, it is one entry here plus
 *    a role row - no schema change.
 */

/** Every in-scope module. Nothing after CUTTING_ISSUE exists. */
export const MODULES = [
  'MASTER_LIST',
  'BUYER',
  'VENDOR',
  'EMPLOYEE',
  'STYLE',
  // FOB cost sheets of a style - prepared by merchandising, signed by the Director.
  'COST_SHEET',
  'USER',
  'ROLE',
  'BUYER_ORDER',
  'PLANNING',
  'VENDOR_QUOTATION',
  'PURCHASE_ORDER',
  'GATE_PASS',
  'GRN',
  // F-04. The compensating document a posted receipt is corrected by. Listed
  // beside the receipt because that is the only place it is ever raised from.
  'GRN_REVERSAL',
  'FABRIC_ROLL',
  'INVENTORY',
  'STOCK_LEDGER',
  'FABRIC_ISSUE',
  'DYE_ISSUE',
  'DYEING_RECEIPT',
  'PRINTING',
  'FABRIC_SCRUTINY',
  'PLAN_APPROVAL',
  // C12. The raw material plan - what fabric and accessories the order needs
  // bought in. Listed here because that is when it happens: the plan is signed
  // before procurement goes to the market.
  'MATERIAL_PLAN',
  // C5. Listed before CUTTING_ISSUE because that is the order the work
  // happens in: the challan is the requirement, the issue fulfils it.
  'CUTTING_CHALLAN',
  // Cut pieces counted in from the cutting floor, before they are issued.
  'CUT_PIECES_RECEIPT',
  'CUTTING_ISSUE',
  'REPORT',
  // Not a document - the trail of who changed what. Read-only by
  // construction: see services/audit.service.js.
  'AUDIT',
];

export const ACTIONS = ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'APPROVE', 'EXPORT'];

/**
 * Modules that carry an approval / authorisation decision in the workbook.
 *
 * CUTTING_ISSUE is here for a different reason from the rest, and the
 * distinction is worth keeping straight: a challan is POSTED, not approved.
 * But production.routes.js guards `POST /cutting-issues/:id/post` with
 * CUTTING_ISSUE.APPROVE deliberately - "this is the point of no return in the
 * whole application and it deserves the same authority as an approval" - and
 * a permission the route demands but the seeder never issues is not a policy,
 * it is a lockout. It left posting reachable by ADMIN alone: a cutting
 * supervisor could raise a challan and then take a 403 trying to post it.
 *
 * DYE_ISSUE and CUTTING_CHALLAN were the same lockout, found later and fixed
 * here. Neither is in the workbook as an approval - the job work order and the
 * cutting challan are both C-series documents - but both were registered with
 * the approval engine and both have approve/reject routes guarded by
 * `DYE_ISSUE.APPROVE` and `CUTTING_CHALLAN.APPROVE`. Without an entry here the
 * seeder generated no such permission row, so no role pattern could match one:
 * the Director's `*.APPROVE` matches PERMISSIONS THAT EXIST, and these did not.
 * The Director could not approve a job work order, and only ADMIN could touch a
 * cutting challan at all.
 *
 * The rule this file is now following consistently: a module whose routes call
 * `can('X.APPROVE')` belongs in this set, and a module whose routes call
 * `can('X.ANYTHING')` belongs in MODULES.
 */
const APPROVABLE = new Set([
  'BUYER_ORDER',
  // The Director signs the FOB a style is quoted at.
  'COST_SHEET',
  'PLANNING',
  'VENDOR_QUOTATION',
  'PURCHASE_ORDER',
  'GATE_PASS',
  'GRN',
  // F-04 - a receipt is posted by one person and UN-posted by another. This is
  // the one document in the system whose whole purpose is to undo somebody
  // else's committed work, which is exactly when a second signature earns its
  // keep. See the registry entry in approvalEngine.js.
  'GRN_REVERSAL',
  // C3 - the job work order is approved before any fabric moves.
  'DYE_ISSUE',
  'FABRIC_SCRUTINY',
  'PLAN_APPROVAL',
  // C12 - the raw material plan is signed before procurement goes to market.
  'MATERIAL_PLAN',
  // C5 - approving a challan authorises an issue; it does not make one.
  'CUTTING_CHALLAN',
  'CUTTING_ISSUE',
]);

/** Read-only modules - they are projections of other documents. */
const READ_ONLY = new Set(['INVENTORY', 'STOCK_LEDGER', 'REPORT', 'AUDIT']);

export function buildPermissions() {
  const out = [];
  for (const module of MODULES) {
    for (const action of ACTIONS) {
      if (action === 'APPROVE' && !APPROVABLE.has(module)) continue;
      if (READ_ONLY.has(module) && !['VIEW', 'EXPORT'].includes(action)) continue;
      out.push({
        code: `${module}.${action}`,
        module,
        action,
        description: `${action.charAt(0) + action.slice(1).toLowerCase()} ${module
          .replace(/_/g, ' ')
          .toLowerCase()}`,
      });
    }
  }
  return out;
}

const ALL = '*';

/** Full ownership of a module: view, create, edit, export (never delete). */
const owns = (module) => [`${module}.VIEW`, `${module}.CREATE`, `${module}.EDIT`, `${module}.EXPORT`];

/** The dropdown/master reads nearly every operational role needs. */
const READS_MASTERS = ['MASTER_LIST.VIEW', 'BUYER.VIEW', 'STYLE.VIEW', 'REPORT.VIEW'];

export const roles = [
  {
    code: 'ADMIN',
    name: 'Admin',
    description:
      'Full access to every in-scope module, plus user, role and master-list administration.',
    isSystem: true,
    permissions: ALL,
  },
  {
    code: 'HEAD_OFFICE',
    name: 'Head Office',
    description:
      'Owns the Master Lists and the record masters (Buyer, Vendor, Style). Read-only on transactions.',
    isSystem: true,
    permissions: [
      'MASTER_LIST.*',
      'BUYER.*',
      'VENDOR.*',
      'STYLE.*',
      'EMPLOYEE.VIEW',
      'EMPLOYEE.EXPORT',
      'BUYER_ORDER.VIEW',
      'COST_SHEET.VIEW',
      'PURCHASE_ORDER.VIEW',
      'INVENTORY.VIEW',
      'REPORT.*',
    ],
  },
  {
    /**
     * ONE DESK, NOT THREE.
     *
     * This role has absorbed two others. PLANNING_OPERATOR went first: raising
     * the order and planning against it is one job, and splitting it only meant
     * one person logged in twice.
     *
     * PLANNING_GM followed, and that merge is the larger one. The GM who owned
     * planning end to end and the desk that prepared the plans are the same desk
     * in practice, so the two logins are now one role holding the union of both
     * sets - nothing invented to make the merge tidy.
     *
     * WHAT THAT MERGE COSTS, STATED PLAINLY. PLANNING.APPROVE arrives here with
     * the GM's set, so this role can both prepare a plan and approve it. That is
     * not a new power - PLANNING_GM already held CREATE and APPROVE together and
     * could always self-approve - but it now reaches the merchandising desk too.
     *
     * WHAT IT DOES NOT COST. PLAN_APPROVAL.APPROVE is still not here. The formal
     * plan sign-off remains the Director's alone, which is the separation that
     * carries the weight; owns() grants view/create/edit/export and deliberately
     * stops short of it.
     */
    code: 'MERCHANDISING',
    name: 'Merchandising & Planning',
    description:
      'Raises and maintains buyer orders, owns the cutting / stitching / shipping and raw '
      + 'material plans end to end, and submits them to the Director for approval.',
    isSystem: true,
    permissions: [
      ...owns('BUYER_ORDER'),
      // Costing is done at the desk that takes the order and quotes the price.
      ...owns('COST_SHEET'),
      'PLANNING.*',
      // C12 - the raw material plan is prepared at the same desk as the rest.
      'MATERIAL_PLAN.*',
      ...owns('PLAN_APPROVAL'),
      'VENDOR.VIEW',
      'CUTTING_CHALLAN.VIEW',
      'CUT_PIECES_RECEIPT.VIEW',
      'CUTTING_ISSUE.VIEW',
      'FABRIC_ISSUE.VIEW',
      'INVENTORY.VIEW',
      'STOCK_LEDGER.VIEW',
      ...READS_MASTERS,
      'REPORT.*',
    ],
  },
  {
    /**
     * ONE DESK, NOT TWO - the same merge as Merchandising & Planning above.
     *
     * CUTTING_SUPERVISOR used to exist beside this role for when the cutting
     * floor got its own logins. It never did: the same person runs the store
     * and the cutting floor. Its permission set was in any case a strict
     * subset of this one, so the merge removed a role and changed nobody's
     * access.
     */
    code: 'STORE_MANAGER',
    name: 'Store & Cutting Manager',
    description:
      'Procurement and store: quotations, purchase orders, gate passes, GRN, rolls, inventory, dyeing, printing. And the cutting floor: fabric issue, cutting challan and cutting issue.',
    isSystem: true,
    permissions: [
      ...owns('VENDOR_QUOTATION'),
      ...owns('PURCHASE_ORDER'),
      ...owns('GATE_PASS'),
      ...owns('GRN'),
      // F-04 - the store finds the mistake and raises the correction. It does
      // NOT sign it: `owns()` grants view/create/edit/export and deliberately
      // excludes APPROVE, which is what keeps the maker and the checker apart
      // on the one document that exists to undo this desk's own work.
      ...owns('GRN_REVERSAL'),
      ...owns('FABRIC_ROLL'),
      ...owns('DYE_ISSUE'),
      ...owns('DYEING_RECEIPT'),
      ...owns('PRINTING'),
      // The cutting floor.
      ...owns('FABRIC_ISSUE'),
      // C5 - the requirement. Raised here, authorised by the Director.
      ...owns('CUTTING_CHALLAN'),
      ...owns('CUT_PIECES_RECEIPT'),
      ...owns('CUTTING_ISSUE'),
      // Posting the challan. Guarded by APPROVE rather than EDIT because it is
      // the point of no return - see production.routes.js.
      'CUTTING_ISSUE.APPROVE',
      'INVENTORY.VIEW',
      'INVENTORY.EXPORT',
      'STOCK_LEDGER.VIEW',
      'STOCK_LEDGER.EXPORT',
      'FABRIC_SCRUTINY.VIEW',
      'PLANNING.VIEW',
      // C12 - procurement buys what the material plan asked for, so it reads it.
      'MATERIAL_PLAN.VIEW',
      'PLAN_APPROVAL.VIEW',
      'BUYER_ORDER.VIEW',
      'VENDOR.VIEW',
      'EMPLOYEE.VIEW',
      ...READS_MASTERS,
      'REPORT.*',
    ],
  },
  {
    /**
     * THE GATE, AND ONLY THE GATE.
     *
     * The guard on the gate raises the pass, because he is the person standing
     * there when the lorry arrives. That is the whole of the job: he records
     * who delivered and when, and nothing else on this screen is his to decide.
     *
     * What is deliberately NOT here is the point of the role:
     *
     *   GATE_PASS.EDIT     - allocating a pass to its purchase order is desk
     *                        work done by whoever holds the paperwork. The
     *                        guard does not know which PO the load answers and
     *                        it is not his job to guess.
     *   GATE_PASS.APPROVE  - clearing a pass states how much actually arrived.
     *                        That is a count somebody is answerable for, and it
     *                        stays with the store and the Director.
     *
     * So the gate can raise a pass and read it back, and can do nothing else in
     * the application at all - not even see a purchase order. VENDOR.VIEW is
     * here because naming who delivered is the one lookup the short form makes.
     */
    code: 'SECURITY',
    name: 'Security (Gate)',
    description:
      'The gate. Raises inward and outward gate passes as vehicles arrive and leave. '
      + 'Does not allocate a pass to a document, clear it, or see anything else.',
    isSystem: true,
    permissions: [
      'GATE_PASS.VIEW',
      'GATE_PASS.CREATE',
      'GATE_PASS.EXPORT',
      'VENDOR.VIEW',
    ],
  },
  {
    code: 'QC',
    name: 'QC',
    description: 'Records the Fabric Scrutiny Report. The decision itself rests with the Director.',
    isSystem: true,
    permissions: [
      ...owns('FABRIC_SCRUTINY'),
      'FABRIC_ROLL.VIEW',
      // Grading a roll's shade and dye lot is an inspection judgement, made
      // at the light box by the same desk that writes the scrutiny report.
      'FABRIC_ROLL.EDIT',
      'DYEING_RECEIPT.VIEW',
      'GRN.VIEW',
      'BUYER_ORDER.VIEW',
      'EMPLOYEE.VIEW',
      ...READS_MASTERS,
    ],
  },
  {
    code: 'DIRECTOR',
    name: 'Director',
    description:
      'Dinesh Sir. Final authority: order excess, quotation authorisation, PO approval, gate pass authorisation, fabric scrutiny decision and plan approval. Sees everything, edits nothing.',
    isSystem: true,
    permissions: ['*.VIEW', '*.EXPORT', '*.APPROVE', 'REPORT.*'],
  },
];
