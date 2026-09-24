/**
 * Sidebar navigation.
 *
 * Each entry names the permission that the corresponding server route requires,
 * so a link is hidden exactly when the API would refuse it. Hiding is a
 * convenience: the server checks the same code on every request.
 *
 * ---------------------------------------------------------------------------
 *  THE GROUPS FOLLOW THE PIPELINE, AND SAY SO
 *
 *  The seven middle groups ARE the process, in the order the work happens:
 *
 *      Dashboard                 Dashboard, Reports, Approvals (queue + plans)
 *    1 Masters                   Buyers, Vendors, Employees, Styles, Dropdown Lists
 *    2 Orders                    Buyer Orders, Planning (production + procurement)
 *    3 Procurement               Vendor Quotations, Purchase Orders
 *    4 Stores                    Gate Pass, Goods Received, Inventory (stock +
 *                                movement + rolls), Fabric Issue
 *    5 Processing                Job Work (dyeing / printing), Fabric Scrutiny
 *    6 Plan Approval             (folded into Dashboard > Approvals)
 *    6 Cutting                   Cutting Challan, Cutting Issue
 *      Administration            Users, Roles, Audit
 *
 *  which is the pipeline the README states and the dashboard's own STAGES list
 *  walks:
 *
 *      MASTERS -> BUYER ORDER -> PLANNING -> VENDOR QUOTATION -> PURCHASE ORDER
 *              -> GATE PASS -> GRN -> INVENTORY -> FABRIC ISSUE -> DYEING
 *              -> PRINTING -> FABRIC SCRUTINY -> PLAN APPROVAL -> CUTTING ISSUE
 *
 *  The `stage` number is carried as DATA rather than written into the label,
 *  so the sidebar can show the sequence without the number becoming part of the
 *  group's name - which is what every other screen, the breadcrumb and the
 *  navigation contract test all match on.
 *
 *  Dashboard and Administration carry no stage. Neither is a step in the work:
 *  one is where you start and the other is how the system is configured, and
 *  numbering them would say they come before Masters and after Cutting.
 *
 *  APPROVALS IS NOT A PROCUREMENT SCREEN
 *
 *  It is the queue of everything awaiting a decision across all eleven modules,
 *  so it sits with the dashboard. It spent a while under Procurement, where it
 *  read as one stage's screen rather than the whole system's - and an approver
 *  signing in is asking "what is waiting on me" before they are asking anything
 *  about purchase orders.
 *
 *  THREE ENTRIES ARE DOORS, NOT SCREENS
 *
 *  Planning, Approvals and Inventory each stand in front of more than one
 *  register. The sidebar had been growing a link per SCREEN rather than a link
 *  per SUBJECT, and short labels stacked in a column are a poor place to tell
 *  near-identical names apart - "Inventory" from "Stock Movement", "Approval
 *  Queue" from "Plan Approval". Each of the three now opens a page that asks
 *  the question in words, with a line under each answer saying what is in it.
 *  See PlanningHub, ApprovalsHub and InventoryHub.
 *
 *  Every register behind them keeps its own route. Reports, the audit trail,
 *  the approval queue and half a dozen detail screens link straight into those
 *  routes, so only the way IN was collapsed.
 *
 *  Two more need a word of explanation.
 *
 *  Dyeing and Printing are ONE entry - Job Work. They are one register in the
 *  database (the workbook's own "Dye issue" sheet covers both) and the screen
 *  carries its own row of process tabs, so a second choice in the sidebar was
 *  the same question asked twice. The tabs still write `?process=`, so a link
 *  to one process still opens on it.
 *
 *  Reports is not in the list above but sits under Dashboard. It is a single
 *  link to a catalogue the server has already filtered by permission, so a user
 *  sees only the reports they may actually run.
 *
 *  The pipeline ends at Cutting Issue. There is deliberately no entry - and no
 *  "coming soon" placeholder - for stitching, hourly monitoring, QC records,
 *  alter, packing, needle checking, dispatch or reconciliation.
 * ---------------------------------------------------------------------------
 */

/*
 * ---------------------------------------------------------------------------
 *  THE SIDEBAR SPELLS OUT WHAT THE DOCUMENTS ABBREVIATE
 *
 *  Four links are named in plain words rather than in trade shorthand, because
 *  the sidebar is what somebody reads on their first day and an acronym there
 *  is a door with no sign on it:
 *
 *      GRN           -> Goods Received
 *      Styles & BOM  -> Styles & Materials
 *      List Masters  -> Dropdown Lists
 *      Audit         -> Audit Trail
 *
 *  THE DOCUMENTS THEMSELVES ARE NOT RENAMED. A GRN is still a GRN on the
 *  screen it opens, in its number (GRN-001), in the permission (GRN.VIEW), in
 *  the audit trail and on the workbook sheet the office already keeps. Those
 *  are the document's IDENTITY, and renaming an identity to be friendlier is
 *  how two names for one thing get into a building. Only the way in is
 *  reworded.
 *
 *  The GROUP headings above are untouched for a different reason: they are the
 *  pipeline the business named, and the §39 contract test asserts them.
 * ---------------------------------------------------------------------------
 */
export const NAV_GROUPS = [
  {
    label: 'Dashboard',
    items: [
      { to: '/', label: 'Dashboard', end: true },
      /**
       * Fourteen operational reports, one per implemented module. Each declares
       * its own permission; the catalogue is filtered by it.
       */
      { to: '/reports', label: 'Reports', permission: 'REPORT.VIEW' },
      /**
       * Everything waiting on a decision, across every module. Behind
       * REPORT.VIEW because it is a read across the whole system, and the
       * Director - who is the last gate nearly everywhere - holds it.
       *
       * It sat under Procurement, which made a queue spanning eleven modules
       * look like a procurement screen. An approver arriving at the ERP is
       * asking "what is waiting on me" before anything else, so it belongs
       * beside the dashboard rather than inside one stage of the pipeline.
       */
      /*
       * ONE ENTRY, TWO REGISTERS.
       *
       * This was "Approval Queue" and "Plan Approval", one under the other.
       * They answer different questions - the queue is a WORKLIST of
       * everything awaiting a decision across every approvable module, keyed
       * on the shared workflowState; the other is a REGISTER of one document
       * type, the plan versions with their rounds and rectifications - but two
       * labels both containing the word "approval" are a coin toss to anybody
       * who has not been told the difference, and people were opening one
       * looking for the other.
       *
       * So the difference is said on the screen instead, where there is room
       * for a line of explanation under each. See ApprovalsHub.
       *
       * The permission is an ARRAY on purpose: `can()` takes any of them, so
       * somebody holding only one of the two still gets the link, and the hub
       * offers them only the register they may actually see.
       */
      {
        to: '/approvals',
        label: 'Approvals',
        /*
         * The plan register keeps its own path, and a plan opened from the
         * queue lands on `/plan-approvals/:id` - which is not under
         * `/approvals`, so without this the menu would go blank underneath
         * somebody who had not left the Approvals screen.
         *
         * See `navMatch` at the foot of this file.
         */
        covers: ['/plan-approvals'],
        permission: ['REPORT.VIEW', 'PLAN_APPROVAL.VIEW'],
      },
    ],
  },
  {
    label: 'Masters',
    stage: 1,
    items: [
      { to: '/masters/buyers', label: 'Buyers', permission: 'BUYER.VIEW' },
      { to: '/masters/vendors', label: 'Vendors', permission: 'VENDOR.VIEW' },
      { to: '/masters/employees', label: 'Employees', permission: 'EMPLOYEE.VIEW' },
      { to: '/masters/styles', label: 'Styles & Materials', permission: 'STYLE.VIEW' },
      { to: '/masters/list-master', label: 'Dropdown Lists', permission: 'MASTER_LIST.VIEW' },
      /**
       * Every tolerance in the system, as data. Under Masters rather than under
       * a transaction module because it IS configuration - the same kind of
       * thing as adding a colour to a dropdown - and it belongs to Head Office
       * rather than to the store that would benefit from a looser limit.
       */
      { to: '/masters/excess-rules', label: 'Excess Rules', permission: 'MASTER_LIST.VIEW' },
    ],
  },
  {
    label: 'Orders',
    stage: 2,
    items: [
      { to: '/orders', label: 'Buyer Orders', permission: 'BUYER_ORDER.VIEW' },
      { to: '/cost-sheets', label: 'Cost Sheets', permission: 'COST_SHEET.VIEW' },
      /*
       * ONE ENTRY, TWO REGISTERS.
       *
       * Production planning (how many pieces, which department, by when) and
       * procurement planning (what has to be bought first) were two links that
       * read as unrelated screens. They are one question asked of two
       * departments, so the kind is chosen ON the screen - see PlanningHub -
       * and the department dropdown follows for the production side, which is
       * the only side that has departments.
       *
       * The permission is an ARRAY on purpose: `can()` takes any of them, so
       * somebody holding only one of the two still gets the link, and the hub
       * offers them only the register they may actually see.
       */
      { to: '/planning', label: 'Planning', permission: ['PLANNING.VIEW', 'MATERIAL_PLAN.VIEW'] },
    ],
  },
  {
    label: 'Procurement',
    stage: 3,
    items: [
      { to: '/quotations', label: 'Vendor Quotations', permission: 'VENDOR_QUOTATION.VIEW' },
      { to: '/purchase-orders', label: 'Purchase Orders', permission: 'PURCHASE_ORDER.VIEW' },
    ],
  },
  {
    label: 'Stores',
    stage: 4,
    items: [
      { to: '/gate-passes', label: 'Gate Pass', permission: 'GATE_PASS.VIEW' },
      { to: '/grns', label: 'Goods Received', permission: 'GRN.VIEW' },
      /*
       * ONE ENTRY, THREE VIEWS.
       *
       * This was three links - Inventory, Stock Movement and Fabric Rolls -
       * onto one subject: what is in the store. Read as a column of short
       * labels in the corner of the window, "Inventory" and "Stock Movement"
       * are not far enough apart to choose between, so people opened one, found
       * it was not the view they wanted, and came back out to try the next.
       *
       * The choice is made on the screen now, where each view gets a line
       * saying what is actually in it. See InventoryHub.
       *
       * The three routes are UNCHANGED and still reachable directly - reports,
       * the audit trail and half a dozen detail screens link straight into
       * them. Only the way in is one link instead of three.
       *
       * The permission is an ARRAY: `can()` takes any of them, so a storeman
       * who may count rolls but may not see the value of the stock still gets
       * the link, and the hub offers him only the view he holds.
       */
      {
        to: '/inventory',
        label: 'Inventory',
        permission: ['INVENTORY.VIEW', 'STOCK_LEDGER.VIEW', 'FABRIC_ROLL.VIEW'],
      },
      { to: '/fabric-issues', label: 'Fabric Issue', permission: 'FABRIC_ISSUE.VIEW' },
    ],
  },
  {
    label: 'Processing',
    stage: 5,
    items: [
      /**
       * One register, two doors. See the note at the top of this file and the
       * header of JobWorkList.jsx.
       */
      /*
       * ONE ENTRY. THE SCREEN ALREADY HAS THE TABS.
       *
       * Dyeing and Printing used to be two links onto this one register,
       * pre-selecting `?process=`. But the register itself opens with a row of
       * process tabs - it always has - so the sidebar was offering a choice
       * the screen then offered again, and a person who arrived by one link
       * and clicked the other tab was somewhere the menu said they were not.
       *
       * The tabs stay and still own `?process=`, so a link to a particular
       * process still opens on it. Only the duplicate way in is gone.
       *
       * Permission is an array: `can()` takes any of them, so somebody who may
       * see only printing still gets the link, and the register shows them the
       * processes they hold.
       */
      { to: '/job-works', label: 'Job Work', permission: ['DYE_ISSUE.VIEW', 'PRINTING.VIEW'] },
      { to: '/scrutinies', label: 'Fabric Scrutiny', permission: 'FABRIC_SCRUTINY.VIEW' },
    ],
  },
  {
    label: 'Cutting',
    stage: 6,
    items: [
      /** C5 - the requirement comes first; the issue fulfils it. */
      { to: '/cutting-challans', label: 'Cutting Challan', permission: 'CUTTING_CHALLAN.VIEW' },
      /** Cut pieces counted in from the cutting floor, before they are issued. */
      { to: '/cut-pieces-receipts', label: 'Cut Pieces Receipt', permission: 'CUT_PIECES_RECEIPT.VIEW' },
      /** The last module in the application. Nothing follows it. */
      { to: '/cutting-issues', label: 'Cutting Issue', permission: 'CUTTING_ISSUE.VIEW' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { to: '/admin/users', label: 'Users', permission: 'USER.VIEW' },
      /**
       * What each role may do. Its own permission rather than USER.VIEW:
       * granting permissions is a broader act than administering logins, and
       * the server gates the endpoints behind ROLE.* accordingly.
       */
      { to: '/admin/roles', label: 'Roles', permission: 'ROLE.VIEW' },
      /**
       * Who changed what. Its own permission rather than USER.VIEW: the trail
       * carries the before-and-after of every rate, price and approval in the
       * system, so seeing it is a broader grant than administering logins.
       */
      { to: '/admin/audit', label: 'Audit Trail', permission: 'AUDIT.VIEW' },
    ],
  },
];


/**
 * Does this navigation entry own the page at `pathname`, and by how much?
 *
 * ---------------------------------------------------------------------------
 *  WHY AN ENTRY OWNS MORE THAN ITS OWN PATH
 *
 *  A menu entry is meant to say "you are here" for as long as you are inside
 *  it. That works by prefix for nearly every screen - `/orders` covers
 *  `/orders/:id` - because a register's detail page lives under the register.
 *
 *  It breaks where one entry stands in front of registers that keep their own
 *  separate paths. Approvals is the case: the plan register is at
 *  `/plan-approvals`, and a plan opened from the queue lands on
 *  `/plan-approvals/:id`. Nothing there begins with `/approvals`, so the
 *  sidebar would light nothing, the group would fall shut, and the breadcrumb
 *  would give up and print the company name - all while the reader is looking
 *  at a screen they reached from Approvals and never left.
 *
 *  `covers` is the entry saying which other paths belong to it. Only entries
 *  that are doors in front of more than one register need it.
 *
 *  MATCHING IS ON A PATH BOUNDARY, not on the raw string: `/orders` owns
 *  `/orders` and `/orders/:id` but not a future `/orders-archive`, which
 *  `startsWith` alone would have handed it.
 *
 *  THE LONGEST MATCH WINS, which is why this returns the matched prefix rather
 *  than true. Where two entries could both claim a page, the more specific one
 *  is the one the reader is actually on.
 * ---------------------------------------------------------------------------
 *
 * @returns the matched prefix, or null. Callers compare lengths to pick a
 *          winner and slice `pathname` with it for what follows.
 */
export function navMatch(item, pathname) {
  const paths = [item.to.split('?')[0], ...(item.covers ?? [])];

  let best = null;
  for (const path of paths) {
    // `end` is the dashboard: it is at the root, so a prefix test would have
    // it own every page in the application.
    const hit = item.end
      ? pathname === path
      : pathname === path || pathname.startsWith(`${path}/`);
    if (hit && (!best || path.length > best.length)) best = path;
  }
  return best;
}

/**
 * Filters the navigation down to what this user may actually open.
 *
 * `stage` travels with the group, so the sidebar can number the pipeline even
 * when a user's permissions hide whole stages of it - a storeman who cannot see
 * Procurement still sees that Stores is step 4, not step 3.
 */
export function visibleNavigation(can) {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permission || can(item.permission)),
  })).filter((group) => group.items.length > 0);
}
