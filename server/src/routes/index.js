import { Router } from 'express';
import prisma from '../config/prisma.js';
import authenticate from '../middleware/authenticate.js';
import { asyncHandler, ok } from '../utils/http.js';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import masterRoutes from './master.routes.js';
import buyerOrderRoutes from './buyerOrder.routes.js';
import planningRoutes from './planning.routes.js';
import materialPlanRoutes from './materialPlan.routes.js';
import vendorQuotationRoutes from './vendorQuotation.routes.js';
import purchaseOrderRoutes from './purchaseOrder.routes.js';
import gatePassRoutes from './gatePass.routes.js';
import grnRoutes from './grn.routes.js';
import grnReversalRoutes from './grnReversal.routes.js';
import cutPiecesReceiptRoutes from './cutPiecesReceipt.routes.js';
import inventoryRoutes from './inventory.routes.js';
import {
  cuttingChallanRoutes,
  cuttingIssueRoutes,
  excessRoutes,
  fabricIssueRoutes,
  jobWorkRoutes,
  planApprovalRoutes,
  scrutinyRoutes,
  workflowRoutes,
} from './production.routes.js';
import toleranceRoutes from './tolerance.routes.js';
import reportRoutes from './report.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import auditRoutes from './audit.routes.js';
import notificationRoutes from './notification.routes.js';
import costSheetRoutes from './costSheet.routes.js';
import { exportRoutes, importRoutes } from './dataTransfer.routes.js';

const router = Router();

/** Liveness + database reachability. Public. */
router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    let database = 'up';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }
    return ok(res, {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      phase: 'Phase 18 - complete: Masters through Cutting Issue',
      pipelineEndsAt: 'CUTTING_ISSUE',
      time: new Date().toISOString(),
    });
  }),
);

// Public + self-service auth.
router.use('/auth', authRoutes);

// Everything past this point requires a valid session.
router.use(authenticate);

router.use('/users', userRoutes);
router.use('/orders', buyerOrderRoutes);
router.use('/cost-sheets', costSheetRoutes);
router.use('/plannings', planningRoutes);
// C12 - the raw material plan: what fabric and accessories this order needs
// bought in. Mounted beside the other plans because it is one of them.
router.use('/material-plans', materialPlanRoutes);
router.use('/quotations', vendorQuotationRoutes);
router.use('/purchase-orders', purchaseOrderRoutes);
router.use('/gate-passes', gatePassRoutes);
router.use('/grns', grnRoutes);
// F-04 - the compensating document a posted receipt is corrected by. Its own
// path rather than a sub-resource of /grns, because it is its own approvable
// document with its own permissions and its own place in the approval queue.
router.use('/grn-reversals', grnReversalRoutes);
// Stock, the ledger, rolls and items all hang off /inventory.
router.use('/inventory', inventoryRoutes);

// The shop floor, and the two engines the whole pipeline leans on.
router.use('/fabric-issues', fabricIssueRoutes);
router.use('/job-works', jobWorkRoutes);
router.use('/scrutinies', scrutinyRoutes);
router.use('/plan-approvals', planApprovalRoutes);
// C5 - the requirement the cutting floor raises BEFORE any fabric is issued.
router.use('/cutting-challans', cuttingChallanRoutes);
router.use('/cut-pieces-receipts', cutPiecesReceiptRoutes);
router.use('/cutting-issues', cuttingIssueRoutes);
router.use('/excess', excessRoutes);
// C2 / C3 - the date-versioned tolerance masters, and the gap report.
router.use('/tolerances', toleranceRoutes);
router.use('/workflow', workflowRoutes);

// The first screen. No permission of its own - it is the union of eleven
// modules, and the service decides section by section what this caller sees.
router.use('/dashboard', dashboardRoutes);

// Operational reports. Each one declares its own permission; the catalogue is
// filtered by it and every run is checked against it.
router.use('/reports', reportRoutes);

// Who changed what. Read-only, behind its own permission.
router.use('/audit', auditRoutes);

// The caller's own inbox - see notification.routes.js.
router.use('/notifications', notificationRoutes);

/*
 * Tables out, masters in.
 *
 * Mounted here rather than under each module because "download this table" is
 * one behaviour, not twenty-eight - see services/dataset.registry.js. Neither
 * route carries a `can()`: both read the required permission from the registry
 * entry the key resolves to, because a permission taken from the URL is a
 * permission the caller chose.
 */
router.use('/exports', exportRoutes);
router.use('/imports', importRoutes);

router.use('/', masterRoutes);

export default router;
