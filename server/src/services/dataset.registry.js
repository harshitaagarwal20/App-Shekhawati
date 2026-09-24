/**
 * Every table in this application that can be exported, in one list.
 *
 * ===========================================================================
 *  WHY A REGISTRY AND NOT AN EXPORT ROUTE PER MODULE
 * ===========================================================================
 *
 *  "Download this table" is the same request twenty-three times over, and the
 *  only things that differ between them are the service that reads the rows,
 *  the permission that guards them and the filters the screen was showing.
 *  Written as twenty-three routes, that is twenty-three places for the export
 *  to drift from the screen - a filter the list honours and the export quietly
 *  ignores is a spreadsheet that is wrong and does not say so.
 *
 *  So each entry below names the SAME `list()` the screen's own endpoint calls,
 *  and the export runner passes it the SAME query. The export is the screen,
 *  unpaged. It cannot show a different set of rows, because it is not a second
 *  reading of the database.
 *
 * ---------------------------------------------------------------------------
 *  THE SHAPE OF AN ENTRY
 *
 *    key         URL segment: /api/exports/<key>/csv
 *    title       What the file and the catalogue call it
 *    group       Where it sits in the client's export menu
 *    module      Permission prefix. Exporting needs `<module>.EXPORT`.
 *    filters     Query keys passed through to the service, and ONLY these.
 *                Anything else in the query string is dropped, so a caller
 *                cannot smuggle a filter the screen has no equivalent of.
 *    sortable    Columns the service will sort on (its own SORTABLE list).
 *    defaultSort / defaultDir
 *    fetch       (query) => { rows, total, ... }  the service's own list()
 *    columns     Optional. Declared only where the file has to have a fixed
 *                shape - see below. Derived from the rows otherwise.
 *    hide        Extra column keys to leave out of a derived column set.
 *
 * ---------------------------------------------------------------------------
 *  WHY MOST ENTRIES DECLARE NO COLUMNS
 *
 *  A hand-written column list on a transaction register is a second place the
 *  screen's shape is written down, and the two drift the first time a column
 *  is added to a list projection: the screen gains it, the export does not,
 *  and nobody notices until a reconciliation comes up short. Deriving the
 *  columns from the rows the service actually returned means an export always
 *  carries the whole row.
 *
 *  The four record masters are the exception, and deliberately so: their
 *  export is also their IMPORT TEMPLATE. That file has to have exactly the
 *  columns the importer accepts, in a stable order, or the round trip -
 *  export, edit in Excel, import back - stops working. Those columns therefore
 *  come from the import field specs in import.service.js, which is the one
 *  place that decides what a master's importable fields are.
 * ---------------------------------------------------------------------------
 */

import * as buyerService from './buyer.service.js';
import * as vendorService from './vendor.service.js';
import * as employeeService from './employee.service.js';
import * as styleService from './style.service.js';
import * as masterListService from './masterList.service.js';
import * as userService from './user.service.js';
import * as roleService from './role.service.js';
import * as buyerOrderService from './buyerOrder.service.js';
import * as planningService from './planning.service.js';
import * as materialPlanService from './materialPlan.service.js';
import * as quotationService from './vendorQuotation.service.js';
import * as purchaseOrderService from './purchaseOrder.service.js';
import * as gatePassService from './gatePass.service.js';
import * as grnService from './grn.service.js';
import * as grnReversalService from './grnReversal.service.js';
import * as inventoryService from './inventory.service.js';
import * as fabricIssueService from './fabricIssue.service.js';
import * as jobWorkService from './jobWork.service.js';
import * as scrutinyService from './fabricScrutiny.service.js';
import * as planApprovalService from './planApproval.service.js';
import * as cuttingChallanService from './cuttingChallan.service.js';
import * as cuttingIssueService from './cuttingIssue.service.js';
import * as cutPiecesReceiptService from './cutPiecesReceipt.service.js';
import * as excessService from './excess.service.js';
import * as auditService from './audit.service.js';
import { MASTER_IMPORTS, importColumns } from './import.service.js';

/** The list-query keys every screen has, on top of each entry's own filters. */
const COMMON_FILTERS = ['search', 'status', 'includeDeleted'];

const DATASETS = [
  // =========================================================================
  //  MASTERS - the four that can also be imported, plus the dropdown lists
  // =========================================================================
  {
    key: 'buyers',
    title: 'Buyers',
    group: 'Masters',
    module: 'BUYER',
    filters: ['country'],
    sortable: buyerService.SORTABLE,
    defaultSort: 'buyerName',
    columns: importColumns('buyers'),
    fetch: (q) => buyerService.list(q),
  },
  {
    key: 'vendors',
    title: 'Vendors',
    group: 'Masters',
    module: 'VENDOR',
    filters: ['category'],
    sortable: vendorService.SORTABLE,
    defaultSort: 'vendorName',
    columns: importColumns('vendors'),
    fetch: (q) => vendorService.list(q),
  },
  {
    key: 'employees',
    title: 'Employees',
    group: 'Masters',
    module: 'EMPLOYEE',
    filters: ['department', 'designation'],
    sortable: employeeService.SORTABLE,
    defaultSort: 'empId',
    columns: importColumns('employees'),
    fetch: (q) => employeeService.list(q),
  },
  {
    key: 'styles',
    title: 'Styles',
    group: 'Masters',
    module: 'STYLE',
    filters: ['buyerId', 'category'],
    sortable: styleService.SORTABLE,
    defaultSort: 'styleNo',
    columns: importColumns('styles'),
    fetch: (q) => styleService.list(q),
  },
  {
    key: 'master-lists',
    title: 'Master lists',
    group: 'Masters',
    module: 'MASTER_LIST',
    filters: [],
    sortable: masterListService.SORTABLE,
    defaultSort: 'code',
    fetch: (q) => masterListService.listLists(q),
    hide: ['values'],
  },
  {
    /**
     * The dropdown VALUES, flattened - one row per value, with its list beside
     * it. The lists themselves export above; this is the sheet somebody
     * actually wants when they ask for "the master lists", because the values
     * are the data and the list is just the heading they sit under.
     */
    key: 'master-list-values',
    title: 'Master list values',
    group: 'Masters',
    module: 'MASTER_LIST',
    filters: [],
    sortable: masterListService.SORTABLE,
    defaultSort: 'code',
    columns: importColumns('master-list-values'),
    fetch: (q) => masterListService.listAllValues(q),
  },

  // =========================================================================
  //  ADMINISTRATION
  // =========================================================================
  {
    key: 'users',
    title: 'Users',
    group: 'Administration',
    module: 'USER',
    filters: ['roleCode'],
    sortable: userService.SORTABLE,
    defaultSort: 'username',
    fetch: (q) => userService.list(q),
    // Never in an export, whatever else changes about the projection.
    hide: ['passwordHash', 'password'],
  },
  {
    key: 'roles',
    title: 'Roles',
    group: 'Administration',
    module: 'ROLE',
    filters: [],
    sortable: roleService.SORTABLE,
    defaultSort: 'code',
    fetch: (q) => roleService.list(q),
  },
  {
    key: 'audit',
    title: 'Audit trail',
    group: 'Administration',
    module: 'AUDIT',
    filters: ['tableName', 'recordId', 'userId', 'action', 'dateFrom', 'dateTo'],
    sortable: auditService.SORTABLE,
    defaultSort: 'createdAt',
    defaultDir: 'desc',
    fetch: (q) => auditService.list(q),
    /*
     * The before/after snapshots are whole rows of JSON. In a spreadsheet they
     * are a wall of braces in one cell; the trail screen renders them field by
     * field, which is where they are readable. The export carries WHO changed
     * WHAT and WHEN, and points at the screen for the diff.
     */
    hide: ['before', 'after', 'changes', 'diff'],
  },

  // =========================================================================
  //  ORDERS AND PLANNING
  // =========================================================================
  {
    key: 'orders',
    title: 'Buyer orders',
    group: 'Orders & planning',
    module: 'BUYER_ORDER',
    filters: [
      'excessApprovalStatus', 'buyerId', 'styleId', 'currency',
      'orderFrom', 'orderTo', 'deliveryFrom', 'deliveryTo',
    ],
    sortable: buyerOrderService.SORTABLE,
    defaultSort: 'orderDate',
    defaultDir: 'desc',
    fetch: (q) => buyerOrderService.list(q),
  },
  {
    key: 'plannings',
    title: 'Plannings',
    group: 'Orders & planning',
    module: 'PLANNING',
    filters: ['approvalStatus', 'state', 'orderId', 'planDepartment', 'containerNo', 'planFrom', 'planTo'],
    sortable: planningService.SORTABLE,
    defaultSort: 'planDate',
    defaultDir: 'desc',
    fetch: (q) => planningService.list(q),
  },
  {
    key: 'material-plans',
    title: 'Material plans',
    group: 'Orders & planning',
    module: 'MATERIAL_PLAN',
    filters: ['approvalStatus', 'workflowState', 'orderId', 'styleId', 'containerNo'],
    sortable: materialPlanService.SORTABLE,
    defaultSort: 'planDate',
    defaultDir: 'desc',
    fetch: (q) => materialPlanService.list(q),
  },
  {
    key: 'plan-approvals',
    title: 'Plan approvals',
    group: 'Orders & planning',
    module: 'PLAN_APPROVAL',
    filters: [
      'approvalStatus', 'orderId', 'planningId', 'containerNo', 'isLocked',
      'latestOnly', 'awaitingRectification', 'dateFrom', 'dateTo',
    ],
    sortable: planApprovalService.SORTABLE,
    defaultSort: 'submittedDate',
    defaultDir: 'desc',
    fetch: (q) => planApprovalService.list(q),
  },

  // =========================================================================
  //  PROCUREMENT
  // =========================================================================
  {
    key: 'quotations',
    title: 'Vendor quotations',
    group: 'Procurement',
    module: 'VENDOR_QUOTATION',
    filters: ['authorisationStatus', 'vendorId', 'orderId', 'item', 'uom', 'dateFrom', 'dateTo'],
    sortable: quotationService.SORTABLE,
    defaultSort: 'quotationDate',
    defaultDir: 'desc',
    fetch: (q) => quotationService.list(q),
  },
  {
    key: 'purchase-orders',
    title: 'Purchase orders',
    group: 'Procurement',
    module: 'PURCHASE_ORDER',
    filters: [
      'approvalStatus', 'vendorId', 'orderId', 'quotationId', 'item', 'orderMode',
      'uom', 'dateFrom', 'dateTo', 'pendingReceipt',
    ],
    sortable: purchaseOrderService.SORTABLE,
    defaultSort: 'poDate',
    defaultDir: 'desc',
    fetch: (q) => purchaseOrderService.list(q),
  },
  {
    key: 'gate-passes',
    title: 'Gate passes',
    group: 'Procurement',
    module: 'GATE_PASS',
    filters: [
      'type', 'purpose', 'vendorId', 'purchaseOrderId', 'linkedDocNo',
      'dateFrom', 'dateTo', 'withVariation',
    ],
    sortable: gatePassService.SORTABLE,
    defaultSort: 'gatePassDate',
    defaultDir: 'desc',
    fetch: (q) => gatePassService.list(q),
  },
  {
    key: 'grns',
    title: 'Goods receipts (GRN)',
    group: 'Procurement',
    module: 'GRN',
    filters: [
      'purchaseOrderId', 'vendorId', 'gatePassId', 'itemId', 'purpose',
      'dateFrom', 'dateTo', 'breachesOnly',
    ],
    sortable: grnService.SORTABLE,
    defaultSort: 'grnDate',
    defaultDir: 'desc',
    fetch: (q) => grnService.list(q),
  },
  {
    key: 'grn-reversals',
    title: 'GRN reversals',
    group: 'Procurement',
    module: 'GRN_REVERSAL',
    filters: ['workflowState', 'grnId', 'purchaseOrderId'],
    sortable: grnReversalService.SORTABLE,
    defaultSort: 'reversalDate',
    defaultDir: 'desc',
    fetch: (q) => grnReversalService.list(q),
  },

  // =========================================================================
  //  INVENTORY
  // =========================================================================
  {
    key: 'items',
    title: 'Items',
    group: 'Inventory',
    module: 'INVENTORY',
    filters: ['itemCategory', 'isActive', 'lowStock'],
    sortable: inventoryService.ITEM_SORTABLE,
    defaultSort: 'itemCode',
    fetch: (q) => inventoryService.listItems(q),
  },
  {
    key: 'stock',
    title: 'Stock summary',
    group: 'Inventory',
    module: 'INVENTORY',
    filters: ['location', 'itemCategory', 'lowStock'],
    // The balance table sorts itself by item code then location; its own
    // columns are not what anybody scans this screen by. Same as the route.
    sortable: [],
    defaultSort: 'id',
    fetch: (q) => inventoryService.stockSummary(q),
  },
  {
    key: 'stock-ledger',
    title: 'Stock ledger',
    group: 'Inventory',
    module: 'STOCK_LEDGER',
    filters: ['itemId', 'rollId', 'orderId', 'location', 'documentType', 'direction', 'dateFrom', 'dateTo'],
    sortable: inventoryService.LEDGER_SORTABLE,
    defaultSort: 'entryDate',
    defaultDir: 'desc',
    fetch: (q) => inventoryService.listLedger(q),
  },
  {
    key: 'rolls',
    title: 'Fabric rolls',
    group: 'Inventory',
    module: 'FABRIC_ROLL',
    filters: ['stage', 'location', 'vendorId', 'grnId', 'itemId', 'colorCode', 'inStockOnly', 'isHeld'],
    sortable: inventoryService.ROLL_SORTABLE,
    defaultSort: 'rollNo',
    fetch: (q) => inventoryService.listRolls(q),
  },

  // =========================================================================
  //  PRODUCTION
  // =========================================================================
  {
    key: 'fabric-issues',
    title: 'Fabric issues',
    group: 'Production',
    module: 'FABRIC_ISSUE',
    filters: ['purpose', 'orderId', 'styleId', 'rollId', 'vendorId', 'employeeId', 'dateFrom', 'dateTo'],
    sortable: fabricIssueService.SORTABLE,
    defaultSort: 'issueDate',
    defaultDir: 'desc',
    fetch: (q) => fabricIssueService.list(q),
  },
  {
    key: 'job-works',
    title: 'Job work orders',
    group: 'Production',
    module: 'DYE_ISSUE',
    filters: [
      'process', 'vendorId', 'orderId', 'styleId', 'rollId', 'fabricStage',
      'dateFrom', 'dateTo', 'pendingReturn', 'breachesOnly',
    ],
    sortable: jobWorkService.SORTABLE,
    defaultSort: 'issueDate',
    defaultDir: 'desc',
    fetch: (q) => jobWorkService.list(q),
  },
  {
    key: 'scrutinies',
    title: 'Fabric scrutinies',
    group: 'Production',
    module: 'FABRIC_SCRUTINY',
    filters: ['decision', 'rollId', 'orderId', 'styleId', 'defectType', 'checkedBy', 'isLocked', 'dateFrom', 'dateTo'],
    sortable: scrutinyService.SORTABLE,
    defaultSort: 'scrutinyDate',
    defaultDir: 'desc',
    fetch: (q) => scrutinyService.list(q),
  },
  {
    key: 'cutting-challans',
    title: 'Cutting challans',
    group: 'Production',
    module: 'CUTTING_CHALLAN',
    filters: ['orderId', 'styleId', 'planningId', 'containerNo', 'openOnly'],
    sortable: cuttingChallanService.SORTABLE,
    defaultSort: 'challanDate',
    defaultDir: 'desc',
    fetch: (q) => cuttingChallanService.list(q),
  },
  {
    key: 'cut-pieces-receipts',
    title: 'Cut pieces receipts',
    group: 'Production',
    module: 'CUT_PIECES_RECEIPT',
    filters: ['orderId', 'styleId', 'cuttingChallanId', 'dateFrom', 'dateTo'],
    sortable: cutPiecesReceiptService.SORTABLE,
    defaultSort: 'receiptDate',
    defaultDir: 'desc',
    fetch: (q) => cutPiecesReceiptService.list(q),
  },
  {
    key: 'cutting-issues',
    title: 'Cutting issues',
    group: 'Production',
    module: 'CUTTING_ISSUE',
    filters: ['orderId', 'styleId', 'firmName', 'containerNo', 'planApprovalId', 'isLocked', 'dateFrom', 'dateTo'],
    sortable: cuttingIssueService.SORTABLE,
    defaultSort: 'issueDate',
    defaultDir: 'desc',
    fetch: (q) => cuttingIssueService.list(q),
  },

  // =========================================================================
  //  THE EXCESS ENGINE
  // =========================================================================
  {
    key: 'excess-rules',
    title: 'Excess rules',
    group: 'Excess',
    module: 'BUYER_ORDER',
    filters: ['scope', 'documentType', 'isActive'],
    sortable: excessService.RULE_SORTABLE,
    defaultSort: 'priority',
    defaultDir: 'desc',
    fetch: (q) => excessService.listRules(q),
  },
  {
    key: 'excess-approvals',
    title: 'Excess authorisations',
    group: 'Excess',
    module: 'BUYER_ORDER',
    filters: ['documentType', 'orderId', 'pendingOnly'],
    sortable: excessService.APPROVAL_SORTABLE,
    defaultSort: 'requestedAt',
    defaultDir: 'desc',
    fetch: (q) => excessService.listApprovals(q),
  },
];

/** Every filter key an entry accepts, its own plus the ones every list has. */
export function filterKeysOf(dataset) {
  return [...COMMON_FILTERS, ...dataset.filters];
}

const BY_KEY = new Map(DATASETS.map((d) => [d.key, d]));

export function allDatasets() {
  return DATASETS;
}

export function datasetFor(key) {
  return BY_KEY.get(key) ?? null;
}

/** The masters that can be imported as well as exported. */
export function importableKeys() {
  return Object.keys(MASTER_IMPORTS);
}
