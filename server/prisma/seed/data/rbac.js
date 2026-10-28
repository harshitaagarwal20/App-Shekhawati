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

/** Every in-scope module, in pipeline order. Stitching follows CUTTING_ISSUE. */
export const MODULES = [
  'MASTER_LIST',
  'BUYER',
  'VENDOR',
  'EMPLOYEE',
  'STYLE',
  // The excess thresholds (Masters > Excess Rules). Their own module rather
  // than MASTER_LIST's: the business keeps them to the store and ADMIN, with
  // the Director reading, while every desk still reads the dropdown lists.
  'EXCESS_RULE',
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
  // Production Phase 2. What each unit stitched in a day, and what each tailor
  // stitched in each hour. Neither is approved - the count is the record.
  'STITCHING_RECORD',
  'HOURLY_MONITORING',
  // Phase 3. Checks taken on the line beside stitching (the workbook's QC
  // Size and QC Defects sheets); each defect goes to the person named in
  // Inform To. Moves no pieces.
  'INLINE_QC',
  // After stitching, before final QC.
  'IRONING',
  // Phase 4. The external agency's check after ironing, the in-house unit
  // that repairs what it finds, and the register of what cannot be repaired.
  'EXTERNAL_QC',
  'ALTERATION',
  'REJECTED_REGISTER',
  // Phase 5. The final QC sheets kept by the checkers, what was rectified,
  // sold online or scrapped, and the reconciliation that closes the order.
  // None is approvable: the sheets record "Status" and "Authorised By", they
  // do not route them through the approval engine.
  'INTERNAL_QUALITY_CHECK',
  'FINAL_CHECKER_REPORT',
  'FINISHED_CHECKER',
  'SPOT_RECTIFICATION',
  // Phase 6. External QC's Approved to the buyer: needle checking (the size
  // assortment cartons), packing and the order-wise dispatch.
  'NEEDLE_DETECTION',
  'PACKING',
  'DISPATCH',
  'RECONCILIATION_REPORT',
  // The cross-module queue of everything awaiting a decision (Dashboard >
  // Approvals). It sat on REPORT.VIEW, which put it in front of every floor
  // desk that runs a report and decides nothing.
  'APPROVAL_QUEUE',
  'REPORT',
  // Not a document - the trail of who changed what. Read-only by
  // construction: see services/audit.service.js.
  'AUDIT',
  // Questions answered by Claude from the reports and the uploaded reference
  // documents. VIEW asks, CREATE uploads a document, DELETE removes one - see
  // services/assistant.service.js.
  'ASSISTANT',
];

export const ACTIONS = ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'APPROVE', 'EXPORT'];

/**
 * Modules that take only some of the standard actions. A document is uploaded
 * and removed, never edited, and there is nothing of the assistant's to export.
 */
const ONLY_ACTIONS = {
  ASSISTANT: ['VIEW', 'CREATE', 'DELETE'],
};

/**
 * Actions particular to one module, beyond the standard set.
 *
 * INLINE_QC.RESOLVE marks who may be named in an Inline QC entry's Inform To
 * - the Inform To dropdown lists the people holding it. Marking a defect
 * Resolved is then for the person named, not for every holder.
 *
 * REPORT.SUMMARY marks who is sent the evening summary of the day's work
 * (services/dailySummary.service.js). The Director holds it through
 * `REPORT.*`; granting it to another role in the Roles screen adds that role's
 * people, and each person can still switch it off in their own settings.
 */
const EXTRA_ACTIONS = {
  INLINE_QC: ['RESOLVE'],
  REPORT: ['SUMMARY'],
};

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
const READ_ONLY = new Set([
  'INVENTORY',
  'STOCK_LEDGER',
  'APPROVAL_QUEUE',
  'REPORT',
  'AUDIT',
  // Written only by the stage that rejected the pieces (the Alteration Unit).
  'REJECTED_REGISTER',
]);

function permission(module, action) {
  return {
    code: `${module}.${action}`,
    module,
    action,
    description: `${action.charAt(0) + action.slice(1).toLowerCase()} ${module
      .replace(/_/g, ' ')
      .toLowerCase()}`,
  };
}

export function buildPermissions() {
  const out = [];
  for (const module of MODULES) {
    for (const action of ACTIONS) {
      if (action === 'APPROVE' && !APPROVABLE.has(module)) continue;
      if (READ_ONLY.has(module) && !['VIEW', 'EXPORT'].includes(action)) continue;
      if (ONLY_ACTIONS[module] && !ONLY_ACTIONS[module].includes(action)) continue;
      out.push(permission(module, action));
    }
    for (const action of EXTRA_ACTIONS[module] ?? []) out.push(permission(module, action));
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
      'APPROVAL_QUEUE.VIEW',
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
      // Phase 2 - the plan said what each unit should deliver each day; this
      // is what it did.
      'STITCHING_RECORD.VIEW',
      'STITCHING_RECORD.EXPORT',
      'HOURLY_MONITORING.VIEW',
      'HOURLY_MONITORING.EXPORT',
      'INLINE_QC.VIEW',
      'INLINE_QC.EXPORT',
      'IRONING.VIEW',
      'IRONING.EXPORT',
      // Phase 4 - what the buyer's pieces did at External QC, and what became
      // of the faulty ones.
      'EXTERNAL_QC.VIEW',
      'EXTERNAL_QC.EXPORT',
      'ALTERATION.VIEW',
      'ALTERATION.EXPORT',
      'REJECTED_REGISTER.VIEW',
      'REJECTED_REGISTER.EXPORT',
      // Phase 5 - "Role Acess - Planning Dept (GM)" on the Reconciliation
      // Report, and the QC sheets it is read against.
      ...owns('RECONCILIATION_REPORT'),
      'INTERNAL_QUALITY_CHECK.VIEW',
      'INTERNAL_QUALITY_CHECK.EXPORT',
      'FINAL_CHECKER_REPORT.VIEW',
      'FINAL_CHECKER_REPORT.EXPORT',
      'FINISHED_CHECKER.VIEW',
      'FINISHED_CHECKER.EXPORT',
      'SPOT_RECTIFICATION.VIEW',
      'SPOT_RECTIFICATION.EXPORT',
      // Phase 6 - the shipping plan is this desk's, so the dispatch that
      // leaves against it is too. Needle checking and packing are read: they
      // are what decides how much is ready to go.
      ...owns('DISPATCH'),
      'NEEDLE_DETECTION.VIEW',
      'NEEDLE_DETECTION.EXPORT',
      'PACKING.VIEW',
      'PACKING.EXPORT',
      'VENDOR.VIEW',
      'CUTTING_CHALLAN.VIEW',
      'CUT_PIECES_RECEIPT.VIEW',
      'CUTTING_ISSUE.VIEW',
      'FABRIC_ISSUE.VIEW',
      'INVENTORY.VIEW',
      'STOCK_LEDGER.VIEW',
      'APPROVAL_QUEUE.VIEW',
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
      // Phase 2 - the store issued the units their cut pieces and sends
      // stitched pieces out for printing, so it reads what was stitched.
      'STITCHING_RECORD.VIEW',
      'STITCHING_RECORD.EXPORT',
      'HOURLY_MONITORING.VIEW',
      'HOURLY_MONITORING.EXPORT',
      'INLINE_QC.VIEW',
      'INLINE_QC.EXPORT',
      // The challans the store issued close as their pieces reach ironing.
      'IRONING.VIEW',
      'IRONING.EXPORT',
      'EXTERNAL_QC.VIEW',
      'EXTERNAL_QC.EXPORT',
      'ALTERATION.VIEW',
      'ALTERATION.EXPORT',
      'REJECTED_REGISTER.VIEW',
      'REJECTED_REGISTER.EXPORT',
      // The excess thresholds. The business's call: the store maintains them,
      // the Director reads them. DELETE stays with ADMIN, as everywhere.
      ...owns('EXCESS_RULE'),
      'APPROVAL_QUEUE.VIEW',
      ...READS_MASTERS,
      'REPORT.*',
    ],
  },
  {
    /**
     * THE IRONING TABLE.
     *
     * Not tied to a unit: ironing takes stitched pieces from every unit, so
     * this desk sees them all. It receives them, records what each ironer
     * pressed and damaged, and decides every damaged piece - re-iron, or
     * reject. No DELETE, for the same reason as the stitching supervisor.
     */
    code: 'FINISHING_SUPERVISOR',
    name: 'Ironing & Finishing Supervisor',
    description:
      'Runs the ironing table: receives stitched pieces from the units, records what each ironer '
      + 'pressed and damaged, and decides each damaged piece - re-iron or reject.',
    isSystem: true,
    permissions: [
      ...owns('IRONING'),
      // Phase 4 - the re-iron and altered pieces come back to this table.
      'EXTERNAL_QC.VIEW',
      'ALTERATION.VIEW',
      'REJECTED_REGISTER.VIEW',
      'MASTER_LIST.VIEW',
      'REPORT.VIEW',
    ],
  },
  {
    /**
     * PHASE 4 - THE EXTERNAL AGENCY'S DESK.
     *
     * Records what the agency found on each inspection. Reads ironing (what
     * has been pressed and can be offered) and the Alteration Unit (where its
     * faulty pieces went). No DELETE, as at every other floor desk.
     */
    code: 'EXTERNAL_QC_COORDINATOR',
    name: 'External QC Coordinator',
    description:
      'Records what the external agency found: pieces offered, approved, sent for alteration and '
      + 'rejected, the reason for each faulty piece and the checker codes on the bags.',
    isSystem: true,
    permissions: [
      ...owns('EXTERNAL_QC'),
      'IRONING.VIEW',
      'ALTERATION.VIEW',
      'REJECTED_REGISTER.VIEW',
      'REJECTED_REGISTER.EXPORT',
      'MASTER_LIST.VIEW',
      'REPORT.VIEW',
    ],
  },
  {
    /**
     * PHASE 4 - THE ALTERATION UNIT.
     *
     * Works the bags External QC and ironing sent. Its not-repairable pieces
     * make the Rejected Register, which it reads but never writes directly.
     */
    code: 'ALTERATION_SUPERVISOR',
    name: 'Alteration Unit Supervisor',
    description:
      'Runs the in-house Alteration Unit: works the bags sent from External QC and from ironing, '
      + 'records pieces altered or cleaned and pieces that cannot be repaired.',
    isSystem: true,
    permissions: [
      ...owns('ALTERATION'),
      'IRONING.VIEW',
      'EXTERNAL_QC.VIEW',
      'REJECTED_REGISTER.VIEW',
      'REJECTED_REGISTER.EXPORT',
      'MASTER_LIST.VIEW',
      'REPORT.VIEW',
    ],
  },
  {
    /**
     * ONE UNIT, AND ONLY THAT UNIT.
     *
     * The supervisor of a stitching unit records the unit's daily output and
     * the hourly count per tailor. WHICH unit is not a permission - it is the
     * Unit / Line on the Employee record this login is tied to, and
     * stitching.service.js holds every read and write to it. A supervisor
     * whose employee names no stitching unit can see nothing to record.
     *
     * No DELETE: a wrong count is corrected by editing it. Removing a day's
     * record is an office decision, and stays with ADMIN.
     */
    code: 'STITCHING_SUPERVISOR',
    name: 'Stitching Supervisor',
    description:
      'Runs one stitching unit. Records the unit\'s daily stitching and the hourly count per '
      + 'tailor, for the orders cut for that unit only. The unit comes from the Unit / Line on '
      + 'the supervisor\'s Employee record.',
    isSystem: true,
    permissions: [
      ...owns('STITCHING_RECORD'),
      ...owns('HOURLY_MONITORING'),
      // Phase 3 - Inline QC tells the unit's supervisor what it found, and
      // the supervisor marks each defect Resolved.
      'INLINE_QC.VIEW',
      'INLINE_QC.EXPORT',
      'INLINE_QC.RESOLVE',
      'MASTER_LIST.VIEW',
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
    description:
      'Records the Fabric Scrutiny Report (the decision itself rests with the Director), the '
      + 'Inline QC checks taken on the stitching line, the final QC sheets and spot rectification, '
      + 'needle checking and packing.',
    isSystem: true,
    permissions: [
      ...owns('FABRIC_SCRUTINY'),
      // Phase 3 - "Role Acess - QC Dept (Checker)" on the QC Size and QC
      // Defects sheets. Not tied to a unit: the checker walks every line.
      ...owns('INLINE_QC'),
      // Phase 5 - the same desk keeps the final QC sheets, and "QC / Packing
      // Dept" keeps Spot Rectification-Scrap until Packing is built.
      ...owns('INTERNAL_QUALITY_CHECK'),
      ...owns('FINAL_CHECKER_REPORT'),
      ...owns('FINISHED_CHECKER'),
      ...owns('SPOT_RECTIFICATION'),
      // Phase 6 - "QC / Packing Dept": needle checking and packing.
      ...owns('NEEDLE_DETECTION'),
      ...owns('PACKING'),
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
    // ASSISTANT.CREATE: uploading a tech pack or an SOP for the assistant to
    // read is not editing a document of the business, which stays the rule.
    permissions: ['*.VIEW', '*.EXPORT', '*.APPROVE', 'REPORT.*', 'ASSISTANT.CREATE'],
  },
];
