import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import AppLayout from '../layouts/AppLayout.jsx';
import { RedirectIfAuthenticated, RequireAuth, RequirePermission } from './ProtectedRoute.jsx';
import { Spinner } from '../components/ui.jsx';

import Login from '../pages/Login.jsx';
const ChangePassword = lazy(() => import('../pages/ChangePassword.jsx'));
const Dashboard = lazy(() => import('../pages/Dashboard.jsx'));
const ApprovalsHub = lazy(() => import('../pages/ApprovalsHub.jsx'));
const Reports = lazy(() => import('../pages/reports/Reports.jsx'));
const Forbidden = lazy(() => import('../pages/Errors.jsx').then((m) => ({ default: m.Forbidden })));
const NotFound = lazy(() => import('../pages/Errors.jsx').then((m) => ({ default: m.NotFound })));

const OrderList = lazy(() => import('../pages/orders/OrderList.jsx'));
const OrderDetail = lazy(() => import('../pages/orders/OrderDetail.jsx'));
const CostSheetList = lazy(() => import('../pages/costing/CostSheetPages.jsx').then((m) => ({ default: m.CostSheetList })));
const CostSheetDetail = lazy(() => import('../pages/costing/CostSheetPages.jsx').then((m) => ({ default: m.CostSheetDetail })));

const PlanningHub = lazy(() => import('../pages/planning/PlanningHub.jsx'));
const PlanningDetail = lazy(() => import('../pages/planning/PlanningDetail.jsx'));
const PlanApprovalDetail = lazy(() => import('../pages/planning/PlanApprovalPages.jsx').then((m) => ({ default: m.PlanApprovalDetail })));
const PlanApprovalList = lazy(() => import('../pages/planning/PlanApprovalPages.jsx').then((m) => ({ default: m.PlanApprovalList })));
// C12 - the raw material plan: what fabric and accessories to buy in.
const MaterialPlanList = lazy(() => import('../pages/planning/MaterialPlanPages.jsx').then((m) => ({ default: m.MaterialPlanList })));
const MaterialPlanDetail = lazy(() => import('../pages/planning/MaterialPlanPages.jsx').then((m) => ({ default: m.MaterialPlanDetail })));

const QuotationList = lazy(() => import('../pages/quotations/QuotationList.jsx'));
const QuotationDetail = lazy(() => import('../pages/quotations/QuotationDetail.jsx'));

const PurchaseOrderList = lazy(() => import('../pages/procurement/PurchaseOrderList.jsx'));
const PurchaseOrderDetail = lazy(() => import('../pages/procurement/PurchaseOrderDetail.jsx'));
const docPage = (name) => lazy(() => import('../pages/procurement/DocumentPages.jsx').then((m) => ({ default: m[name] })));
const PoDocumentForm = docPage('PoDocumentForm');
const PoDocumentDetail = docPage('PoDocumentDetail');
const PoDocumentPrint = docPage('PoDocumentPrint');
const QuotationDocumentForm = docPage('QuotationDocumentForm');
const QuotationDocumentDetail = docPage('QuotationDocumentDetail');
const GrnDocumentForm = docPage('GrnDocumentForm');
const GrnDocumentDetail = docPage('GrnDocumentDetail');
const GatePassList = lazy(() => import('../pages/procurement/GatePassList.jsx'));
const GatePassDetail = lazy(() => import('../pages/procurement/GatePassDetail.jsx'));
const GrnList = lazy(() => import('../pages/procurement/GrnList.jsx'));
const GrnDetail = lazy(() => import('../pages/procurement/GrnDetail.jsx'));
// F-04 - the correction raised against a posted receipt. Reached from the
// receipt and from the approval queue; deliberately not in the navigation.
const GrnReversalDetail = lazy(() => import('../pages/procurement/GrnReversalDetail.jsx'));

const InventoryHub = lazy(() => import('../pages/inventory/InventoryHub.jsx'));
const OpeningStockPage = lazy(() => import('../pages/inventory/OpeningStockPage.jsx'));
const StockSummary = lazy(() => import('../pages/inventory/StockSummary.jsx'));
const StockLedgerPage = lazy(() => import('../pages/inventory/StockLedgerPage.jsx'));
const RollList = lazy(() => import('../pages/inventory/RollList.jsx'));
const RollDetail = lazy(() => import('../pages/inventory/RollDetail.jsx'));

const FabricIssueDetail = lazy(() => import('../pages/production/FabricIssueList.jsx').then((m) => ({ default: m.FabricIssueDetail })));
const FabricIssueList = lazy(() => import('../pages/production/FabricIssueList.jsx').then((m) => ({ default: m.FabricIssueList })));
const FabricIssueForm = lazy(() => import('../pages/production/FabricIssueForm.jsx'));
const JobWorkList = lazy(() => import('../pages/production/JobWorkList.jsx'));
const JobWorkDetail = lazy(() => import('../pages/production/JobWorkDetail.jsx'));
const ScrutinyDetail = lazy(() => import('../pages/production/ScrutinyPages.jsx').then((m) => ({ default: m.ScrutinyDetail })));
const ScrutinyList = lazy(() => import('../pages/production/ScrutinyPages.jsx').then((m) => ({ default: m.ScrutinyList })));

const CuttingIssueDetail = lazy(() => import('../pages/cutting/CuttingIssuePages.jsx').then((m) => ({ default: m.CuttingIssueDetail })));
const CuttingIssueList = lazy(() => import('../pages/cutting/CuttingIssuePages.jsx').then((m) => ({ default: m.CuttingIssueList })));
const CuttingIssueForm = lazy(() => import('../pages/cutting/CuttingIssueForm.jsx'));
// C8 - how long documents sit at each step.
// C5 - the requirement the cutting floor raises before any fabric is issued.
const CuttingChallanList = lazy(() => import('../pages/cutting/CuttingChallanPages.jsx').then((m) => ({ default: m.CuttingChallanList })));
const CuttingChallanDetail = lazy(() => import('../pages/cutting/CuttingChallanPages.jsx').then((m) => ({ default: m.CuttingChallanDetail })));
// Cut pieces counted in from the cutting department, before issue to stitching.
const CutPiecesReceiptList = lazy(() => import('../pages/cutting/CutPiecesReceiptPages.jsx').then((m) => ({ default: m.CutPiecesReceiptList })));
const CutPiecesReceiptDetail = lazy(() => import('../pages/cutting/CutPiecesReceiptPages.jsx').then((m) => ({ default: m.CutPiecesReceiptDetail })));

const DocumentPrint = lazy(() => import('../pages/print/DocumentPrint.jsx'));

const ListMaster = lazy(() => import('../pages/masters/ListMaster.jsx'));
const Buyers = lazy(() => import('../pages/masters/Buyers.jsx'));
const Vendors = lazy(() => import('../pages/masters/Vendors.jsx'));
const Employees = lazy(() => import('../pages/masters/Employees.jsx'));
const Styles = lazy(() => import('../pages/masters/Styles.jsx'));
const ExcessRules = lazy(() => import('../pages/admin/ExcessRules.jsx'));

const Users = lazy(() => import('../pages/admin/Users.jsx'));
const Roles = lazy(() => import('../pages/admin/Roles.jsx'));
const Audit = lazy(() => import('../pages/admin/Audit.jsx'));

/**
 * Route table.
 *
 * ---------------------------------------------------------------------------
 *  EVERY SCREEN IS A SEPARATE CHUNK
 *
 *  There are forty-odd screens here and a user opens two or three of them in a
 *  session, but a single bundle made every one of them the cost of signing in -
 *  the print sheets, the excess rules editor, the audit trail, all downloaded
 *  before the login form could be typed into. That is paid on the factory's
 *  connection, on every cold load.
 *
 *  So each route is `lazy()`, and Vite emits it as its own chunk fetched the
 *  first time somebody navigates to it.
 *
 *  Three things stay eager on purpose: `AppLayout`, `ProtectedRoute` and
 *  `Login`. All three are on the critical path of the very first paint, and
 *  splitting them would add a network round trip to the thing the user is
 *  already waiting for.
 * ---------------------------------------------------------------------------
 *
 * Permission guards here decide what a user can NAVIGATE to. They are a
 * usability measure. The server independently authorises every request behind
 * these screens, and that is what actually protects the data.
 *
 * The routes follow the pipeline, and it ends at Cutting Issue. There is no
 * route - and no placeholder - for anything after it.
 */

/** Wraps a page in its permission guard, so the table below stays readable. */
const guarded = (permission, element) => (
  <RequirePermission permissions={[permission]}>{element}</RequirePermission>
);

/**
 * Shown while a route's chunk is in flight.
 *
 * Deliberately plain and unpositioned: on a warm cache it is on screen for a
 * frame or two, and a large animated placeholder that flashes is worse than a
 * small one that does.
 */
function RouteLoading() {
  return (
    <div className="loading-row">
      <Spinner label="Loading..." />
    </div>
  );
}

export default function AppRoutes() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
      <Route
        path="/login"
        element={
          <RedirectIfAuthenticated>
            <Login />
          </RedirectIfAuthenticated>
        }
      />

      <Route element={<RequireAuth />}>
        {/* Outside the shell: reachable while mustChangePassword blocks everything else. */}
        <Route path="/change-password" element={<ChangePassword />} />

        <Route element={<AppLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="/forbidden" element={<Forbidden />} />

          {/* One door for the cross-module queue and the plan-version
              register. Guarded on EITHER permission, because a planner who may
              read plan approvals but not the whole system's queue still has
              somewhere to go here; the hub offers them only what they hold. */}
          <Route
            path="/approvals"
            element={(
              <RequirePermission permissions={['REPORT.VIEW', 'PLAN_APPROVAL.VIEW']}>
                <ApprovalsHub />
              </RequirePermission>
            )}
          />

          {/* Fourteen reports, one generic screen. Each report's own permission
              is checked by the API on every run. */}
          <Route path="/reports" element={guarded('REPORT.VIEW', <Reports />)} />

          {/* --- Orders ---------------------------------------------------- */}
          <Route path="/orders" element={guarded('BUYER_ORDER.VIEW', <OrderList />)} />
          <Route path="/orders/:id" element={guarded('BUYER_ORDER.VIEW', <OrderDetail />)} />
          <Route path="/cost-sheets" element={guarded('COST_SHEET.VIEW', <CostSheetList />)} />
          <Route path="/cost-sheets/:id" element={guarded('COST_SHEET.VIEW', <CostSheetDetail />)} />

          {/* --- Planning -------------------------------------------------- */}
          {/* One door for both kinds of plan; the hub picks which register to
              show. Guarded on EITHER permission, because a procurement clerk
              who cannot see production plans still has procurement ones. */}
          <Route
            path="/planning"
            element={(
              <RequirePermission permissions={['PLANNING.VIEW', 'MATERIAL_PLAN.VIEW']}>
                <PlanningHub />
              </RequirePermission>
            )}
          />
          <Route path="/planning/:id" element={guarded('PLANNING.VIEW', <PlanningDetail />)} />
          <Route
            path="/plan-approvals"
            element={guarded('PLAN_APPROVAL.VIEW', <PlanApprovalList />)}
          />
          <Route
            path="/plan-approvals/:id"
            element={guarded('PLAN_APPROVAL.VIEW', <PlanApprovalDetail />)}
          />

          {/* C12. The raw material plan is signed before procurement goes to
              the market, so it sits between planning and the buying screens. */}
          <Route
            path="/material-plans"
            element={guarded('MATERIAL_PLAN.VIEW', <MaterialPlanList />)}
          />
          <Route
            path="/material-plans/:id"
            element={guarded('MATERIAL_PLAN.VIEW', <MaterialPlanDetail />)}
          />

          {/* --- Procurement ----------------------------------------------- */}
          <Route path="/quotations" element={guarded('VENDOR_QUOTATION.VIEW', <QuotationList />)} />
          <Route path="/quotations/new-document" element={guarded('VENDOR_QUOTATION.CREATE', <QuotationDocumentForm />)} />
          <Route path="/quotations/documents/:id" element={guarded('VENDOR_QUOTATION.VIEW', <QuotationDocumentDetail />)} />
          <Route path="/purchase-orders/new-document" element={guarded('PURCHASE_ORDER.CREATE', <PoDocumentForm />)} />
          <Route path="/purchase-orders/documents/:id" element={guarded('PURCHASE_ORDER.VIEW', <PoDocumentDetail />)} />
          <Route
            path="/quotations/:id"
            element={guarded('VENDOR_QUOTATION.VIEW', <QuotationDetail />)}
          />
          <Route
            path="/purchase-orders"
            element={guarded('PURCHASE_ORDER.VIEW', <PurchaseOrderList />)}
          />
          <Route
            path="/purchase-orders/:id"
            element={guarded('PURCHASE_ORDER.VIEW', <PurchaseOrderDetail />)}
          />
          <Route path="/gate-passes" element={guarded('GATE_PASS.VIEW', <GatePassList />)} />
          <Route path="/gate-passes/:id" element={guarded('GATE_PASS.VIEW', <GatePassDetail />)} />
          <Route path="/grns" element={guarded('GRN.VIEW', <GrnList />)} />
          <Route path="/grns/new-document" element={guarded('GRN.CREATE', <GrnDocumentForm />)} />
          <Route path="/grns/documents/:id" element={guarded('GRN.VIEW', <GrnDocumentDetail />)} />
          <Route path="/grns/:id" element={guarded('GRN.VIEW', <GrnDetail />)} />
          <Route
            path="/grn-reversals/:id"
            element={guarded('GRN_REVERSAL.VIEW', <GrnReversalDetail />)}
          />

          {/* --- Store ------------------------------------------------------ */}
          {/* One door for the three ways of counting the store. The three
              routes below are untouched: reports, the audit trail and half a
              dozen detail screens link straight into them. */}
          <Route
            path="/inventory"
            element={(
              <RequirePermission
                permissions={['INVENTORY.VIEW', 'STOCK_LEDGER.VIEW', 'FABRIC_ROLL.VIEW']}
              >
                <InventoryHub />
              </RequirePermission>
            )}
          />
          <Route path="/inventory/stock" element={guarded('INVENTORY.VIEW', <StockSummary />)} />
          <Route
            path="/inventory/stock/ledger"
            element={guarded('STOCK_LEDGER.VIEW', <StockLedgerPage />)}
          />
          {/* One-time go-live load. Filed under Masters because it is setup,
              not stores work - see the note in config/navigation.js. */}
          <Route
            path="/masters/opening-stock"
            element={guarded('FABRIC_ROLL.CREATE', <OpeningStockPage />)}
          />
          <Route path="/inventory/rolls" element={guarded('FABRIC_ROLL.VIEW', <RollList />)} />
          <Route path="/inventory/rolls/:id" element={guarded('FABRIC_ROLL.VIEW', <RollDetail />)} />
          {/* An item's own page reuses the ledger, filtered to it. */}
          <Route
            path="/inventory/items/:id"
            element={guarded('STOCK_LEDGER.VIEW', <StockLedgerPage />)}
          />

          {/* --- Production -------------------------------------------------- */}
          {/* "new" before ":id", so it is not read as an id. */}
          <Route
            path="/fabric-issues/new"
            element={guarded('FABRIC_ISSUE.CREATE', <FabricIssueForm />)}
          />
          <Route path="/fabric-issues" element={guarded('FABRIC_ISSUE.VIEW', <FabricIssueList />)} />
          <Route
            path="/fabric-issues/:id"
            element={guarded('FABRIC_ISSUE.VIEW', <FabricIssueDetail />)}
          />

          <Route path="/job-works" element={guarded('DYE_ISSUE.VIEW', <JobWorkList />)} />
          <Route path="/job-works/:id" element={guarded('DYE_ISSUE.VIEW', <JobWorkDetail />)} />

          <Route path="/scrutinies" element={guarded('FABRIC_SCRUTINY.VIEW', <ScrutinyList />)} />
          <Route
            path="/scrutinies/:id"
            element={guarded('FABRIC_SCRUTINY.VIEW', <ScrutinyDetail />)}
          />

          {/* --- Cutting: the last module ------------------------------------ */}

          {/* C5. The challan comes BEFORE the issue, both in the process and
              here: fabric may only be issued against an approved one. */}
          <Route
            path="/cutting-challans"
            element={guarded('CUTTING_CHALLAN.VIEW', <CuttingChallanList />)}
          />
          <Route
            path="/cutting-challans/:id"
            element={guarded('CUTTING_CHALLAN.VIEW', <CuttingChallanDetail />)}
          />

          <Route
            path="/cut-pieces-receipts"
            element={guarded('CUT_PIECES_RECEIPT.VIEW', <CutPiecesReceiptList />)}
          />
          <Route
            path="/cut-pieces-receipts/:id"
            element={guarded('CUT_PIECES_RECEIPT.VIEW', <CutPiecesReceiptDetail />)}
          />

          <Route
            path="/cutting-issues/new"
            element={guarded('CUTTING_ISSUE.CREATE', <CuttingIssueForm />)}
          />
          <Route
            path="/cutting-issues"
            element={guarded('CUTTING_ISSUE.VIEW', <CuttingIssueList />)}
          />
          <Route
            path="/cutting-issues/:id"
            element={guarded('CUTTING_ISSUE.VIEW', <CuttingIssueDetail />)}
          />

          {/* --- Printing ----------------------------------------------------
              One route for all five printable documents. The payload is
              assembled on the server; this renders it. */}
          <Route path="/print/po-document/:id" element={guarded('PURCHASE_ORDER.EXPORT', <PoDocumentPrint />)} />
          <Route path="/print/:kind/:id" element={<DocumentPrint />} />

          {/* --- Masters ------------------------------------------------------ */}
          <Route path="/masters/list-master" element={guarded('MASTER_LIST.VIEW', <ListMaster />)} />
          <Route path="/masters/buyers" element={guarded('BUYER.VIEW', <Buyers />)} />
          <Route path="/masters/vendors" element={guarded('VENDOR.VIEW', <Vendors />)} />
          <Route path="/masters/employees" element={guarded('EMPLOYEE.VIEW', <Employees />)} />
          <Route path="/masters/styles" element={guarded('STYLE.VIEW', <Styles />)} />
          <Route
            path="/masters/excess-rules"
            element={guarded('MASTER_LIST.VIEW', <ExcessRules />)}
          />

          {/* --- Administration ----------------------------------------------- */}
          <Route path="/admin/users" element={guarded('USER.VIEW', <Users />)} />
          <Route path="/admin/roles" element={guarded('ROLE.VIEW', <Roles />)} />
          {/* Read-only. There is no write endpoint behind this screen. */}
          <Route path="/admin/audit" element={guarded('AUDIT.VIEW', <Audit />)} />
          {/* C8 - read-only too: the views are derived from the approval trail. */}

          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
      </Routes>
    </Suspense>
  );
}
