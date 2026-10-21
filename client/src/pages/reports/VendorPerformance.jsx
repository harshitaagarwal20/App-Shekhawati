/**
 * Vendor performance - who to keep giving work to.
 *
 * Four views, each a report from the server's registry, so the figures, the
 * permission and the CSV match the Reports screen:
 *
 *     Dyers & job workers   shrinkage against the allowance, and lots held
 *                           for scrutiny
 *     Supplier delivery     PO lines received in full by the delivery date
 *     Cutting wastage       how much of each mill's fabric was wasted at the
 *                           cutting table (the supplier-yield report)
 *     Defect reasons        what the floor rejected, stage by stage
 *
 * Every chart arrives ranked from the server and covers the whole report,
 * not the page of the table under it.
 */

import { fmtNum } from '../../utils/format.js';
import AnalysisScreen from './AnalysisScreen.jsx';

const noDates = (count, what) =>
  count > 0
    ? `None of these ${count} ${what} has a delivery date, so none can be judged on time. ` +
      'Fill in "Deliver by" when raising them.'
    : 'Nothing has fallen due yet for these filters.';

const VIEWS = [
  {
    key: 'jobworker-performance',
    label: 'Dyers & job workers',
    tiles: (t) => [
      { label: 'Job workers', value: fmtNum(t.jobWorkers) },
      { label: 'Jobs', value: fmtNum(t.jobs) },
      { label: 'Shrinkage', value: t.shrinkagePct ?? '—', sub: t.allowedPct ? `allowed ${t.allowedPct}` : undefined },
      { label: 'Jobs over allowance', value: fmtNum(t.overAllowance), bad: t.overAllowance > 0 },
      { label: 'Overdue now', value: fmtNum(t.overdue), bad: t.overdue > 0 },
    ],
    chartEmpty: () => 'No job has been completed yet.',
  },
  {
    key: 'supplier-delivery',
    label: 'Supplier delivery',
    tiles: (t) => [
      { label: 'Suppliers', value: fmtNum(t.suppliers) },
      { label: 'Lines due', value: fmtNum(t.dueLines) },
      { label: 'On time', value: t.onTimePct ?? '—' },
      { label: 'Late', value: fmtNum(t.lateLines), bad: t.lateLines > 0 },
      { label: 'Overdue now', value: fmtNum(t.overdueLines), bad: t.overdueLines > 0 },
      { label: 'Avg days late', value: t.avgDaysLate ?? '—' },
      { label: 'Lines with no delivery date', value: fmtNum(t.undated), bad: t.undated > 0 },
    ],
    chartEmpty: (_chart, t) => noDates(t.undated, 'PO lines'),
  },
  {
    key: 'supplier-yield',
    label: 'Cutting wastage',
    tiles: (t) => [
      { label: 'Suppliers', value: fmtNum(t.suppliers) },
      { label: 'Items', value: fmtNum(t.items) },
      { label: 'Issued to cutting', value: fmtNum(t.cutIssuedQty) },
      { label: 'Overall cutting yield', value: t.yieldPct ?? '—' },
      { label: 'Best yield', value: t.bestSupplier ?? '—', small: true },
    ],
    chartEmpty: () => 'None of this fabric has been cut yet.',
  },
  {
    key: 'defect-reasons',
    label: 'Defect reasons',
    tiles: (t) => [
      { label: 'Stages with defects', value: fmtNum(t.stages) },
      { label: 'Reasons', value: fmtNum(t.reasons) },
      { label: 'Biggest single reason', value: t.topReason ?? '—', small: true },
      ...(t.withheld > 0
        ? [{ label: 'Stages not shown', value: fmtNum(t.withheld), sub: 'your role cannot view them' }]
        : []),
    ],
  },
];

export default function VendorPerformance() {
  return (
    <AnalysisScreen
      title="Vendor Performance"
      views={VIEWS}
      showTable={false}
      emptyMessage="Your role does not have access to any of the vendor performance reports."
    />
  );
}
