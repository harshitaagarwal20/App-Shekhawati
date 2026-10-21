/**
 * Inventory analysis - the store, supplier by supplier.
 *
 * Three views, each one a report from the server's registry
 * (reports.inventory.js), so the figures, the permission and the CSV are the
 * same ones the Reports screen gives. The three questions people ask of a
 * supplier's fabric -
 *
 *     how much of theirs do we hold?          Stock by supplier
 *     how well does their cloth cut?          Supplier yield
 *     what did inspection find on arrival?    Inward inspection
 *
 * The screen itself - tabs, filters, tiles, charts, table - is AnalysisScreen,
 * shared with Vendor Performance. The active view lives in `?tab=`.
 */

import { fmtMoney, fmtNum } from '../../utils/format.js';
import AnalysisScreen from '../reports/AnalysisScreen.jsx';

/*
 * `tiles` turns the report's totals into the headline row. Every figure is
 * already computed on the server; this only picks which ones to show and how.
 */
const VIEWS = [
  {
    key: 'supplier-stock',
    label: 'Stock by supplier',
    tiles: (t) => [
      { label: 'Suppliers', value: fmtNum(t.suppliers) },
      { label: 'Items', value: fmtNum(t.items) },
      { label: 'On hand', value: fmtNum(t.onHandQty) },
      { label: 'Stock value', value: fmtMoney(t.value) },
      { label: 'With job workers', value: fmtNum(t.withJobWorkerQty) },
      { label: 'Held / rejected', value: fmtNum(t.heldQty), bad: Number(t.heldQty) > 0 },
      { label: 'Older than 90 days', value: fmtNum(t.agedQty), bad: Number(t.agedQty) > 0 },
      { label: 'Rolls awaiting inspection', value: fmtNum(t.inspectionPending), bad: t.inspectionPending > 0 },
    ],
  },
  {
    key: 'supplier-yield',
    label: 'Supplier yield',
    tiles: (t) => [
      { label: 'Suppliers', value: fmtNum(t.suppliers) },
      { label: 'Items', value: fmtNum(t.items) },
      { label: 'Received', value: fmtNum(t.receivedQty) },
      { label: 'Issued to cutting', value: fmtNum(t.cutIssuedQty) },
      { label: 'Overall cutting yield', value: t.yieldPct ?? '—' },
      { label: 'Best yield', value: t.bestSupplier ?? '—', small: true },
    ],
    chartEmpty: () => 'None of this fabric has been cut yet.',
  },
  {
    key: 'inward-inspection',
    label: 'Inward inspection',
    tiles: (t) => [
      {
        label: 'Awaiting inspection',
        value: fmtNum(t.pending),
        sub: `${fmtNum(t.pendingQty)} on those rolls`,
        bad: t.pending > 0,
      },
      { label: 'Passed', value: fmtNum(t.passed) },
      { label: 'Failed', value: fmtNum(t.failed), bad: t.failed > 0 },
      { label: 'Faulty length found', value: fmtNum(t.defectQty) },
      { label: 'Short length found', value: fmtNum(t.shortQty) },
    ],
  },
];

export default function InventoryAnalysis() {
  return (
    <AnalysisScreen
      title="Inventory Analysis"
      views={VIEWS}
      category="INVENTORY"
      emptyMessage="Your role does not have access to the inventory analysis reports."
    />
  );
}
