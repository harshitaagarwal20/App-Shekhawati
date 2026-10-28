/**
 * The arithmetic of Phase 5 - final QC, spot rectification and the
 * reconciliation.
 *
 * ---------------------------------------------------------------------------
 *  ONE PLACE FOR EVERY "FORMULA" COLUMN
 *
 *  Each workbook sheet from "Internal Quality Check" to "Reconciliation
 *  Report" marks some of its columns Formula or Auto. Those are worked out
 *  here and nowhere else: the service stores what these functions return, the
 *  CHECK constraints in 20261022000100 hold the same equations, and the rules
 *  tests drive these functions directly. Nothing here touches the database.
 *
 *  The sheets' IFERROR(x / y, 0) is kept deliberately: a ratio over nothing
 *  checked is 0, not an error and not infinity.
 *
 *  Each `check*` returns the first rule a record breaks as `{ field, message }`
 *  - the field is the form input to highlight - or null when it is sound.
 * ---------------------------------------------------------------------------
 */

/** Whole pieces. Non-numbers read as 0. */
const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/**
 * x / y as a fraction to six places, the sheets' IFERROR(x / y, 0). A string,
 * because the column is a Decimal and a float would print 0.30000000000000004.
 */
export function ratio(numerator, denominator) {
  const d = n(denominator);
  if (d === 0) return '0';
  return (n(numerator) / d).toFixed(6);
}

// ===========================================================================
//  INTERNAL QUALITY CHECK, FINAL CHECKER REPORT
// ===========================================================================

export function checkDefectsWithinChecked(checked, defects, defectField) {
  if (n(defects) > n(checked)) {
    return {
      field: defectField,
      message: `Defect pieces (${n(defects)}) cannot be more than the pieces checked (${n(checked)})`,
    };
  }
  return null;
}

/** The QC status after which the work goes back to a unit. */
export const QC_STATUS_REJECTED = 'Rejected';

/** "Total Defect Pcs" = SUM(the count on each defect line). */
export function internalQcDefectTotal(defects = []) {
  return defects.reduce((sum, d) => sum + n(d.qty), 0);
}

export function checkInternalQualityCheck({ totalPcsChecked, defects = [], qcStatus, transferredBackToUnit }) {
  const seen = new Set();
  for (const d of defects) {
    if (seen.has(d.defectType)) {
      return { field: 'defects', message: `"${d.defectType}" is on the check twice - put its whole count on one line` };
    }
    seen.add(d.defectType);
  }
  const total = internalQcDefectTotal(defects);
  if (total > n(totalPcsChecked)) {
    return {
      field: 'defects',
      message: `The defects add up to ${total}, more than the ${n(totalPcsChecked)} pieces checked`,
    };
  }
  // The sheet: "Transferred Back To Unit - if Rejected".
  if (qcStatus === QC_STATUS_REJECTED && !transferredBackToUnit) {
    return {
      field: 'transferredBackToUnit',
      message: 'Rejected work goes back to a unit - say which one',
    };
  }
  return null;
}

// ===========================================================================
//  FINISHED CHECKER
// ===========================================================================

/** The seventeen defect columns, in the sheet's order. */
export const FINISHED_CHECKER_DEFECTS = [
  { key: 'untrimmedThread', label: 'Untrimmed Thread' },
  { key: 'handleOut', label: 'Handle out' },
  { key: 'handleSize', label: 'Handle size' },
  { key: 'handleAlter', label: 'Handle Alter' },
  { key: 'withoutLabel', label: 'Without Label' },
  { key: 'slantedLabel', label: 'Slanted Label' },
  { key: 'doubleLupi', label: 'Double Lupi' },
  { key: 'withoutLupi', label: 'Without Lupi' },
  { key: 'wrongSideLupi', label: 'Wrong side lupi' },
  { key: 'weavingDefect', label: 'Weaving defect' },
  { key: 'cutHole', label: 'Cut/hole' },
  { key: 'improperHem', label: 'Improper Hem' },
  { key: 'doubleStitch', label: 'Double Stitch' },
  { key: 'withoutStitch', label: 'Without stitch' },
  { key: 'torn', label: 'Torn' },
  { key: 'stain', label: 'Stain' },
  { key: 'alter', label: 'Alter' },
];

/**
 * Projected = SUM(defects), Total pieces passed = Checked - Projected,
 * Defects % = Projected / Checked.
 */
export function finishedCheckerTotals(checkedPcs, counts) {
  const totalDefects = FINISHED_CHECKER_DEFECTS.reduce((sum, d) => sum + n(counts[d.key]), 0);
  return {
    totalDefects,
    piecesPassed: n(checkedPcs) - totalDefects,
    defectPct: ratio(totalDefects, checkedPcs),
  };
}

export function checkFinishedChecker(checkedPcs, counts) {
  const { totalDefects } = finishedCheckerTotals(checkedPcs, counts);
  if (totalDefects > n(checkedPcs)) {
    return {
      field: 'checkedPcs',
      message: `The defects add up to ${totalDefects}, more than the ${n(checkedPcs)} pieces checked`,
    };
  }
  return null;
}

// ===========================================================================
//  EXTERNAL SECONDARY CHECKING - THE INSPECTION GRID ON AN EXTERNAL QC ENTRY
// ===========================================================================

/**
 * Each line's Total = Critical + Major + Minor; the report's totals block is
 * the column sums, Total Pass Quantity = Inspection Qty - Total Defect and
 * Total Defect Ratio = Total Defect / Inspection Qty. On an External QC entry
 * the Inspection Qty is the Pcs Offered.
 */
export function inspectionTotals(inspectionQty, lines = []) {
  const out = lines.map((l) => {
    const critical = n(l.critical);
    const major = n(l.major);
    const minor = n(l.minor);
    return { ...l, critical, major, minor, total: critical + major + minor };
  });
  const criticalTotal = out.reduce((s, l) => s + l.critical, 0);
  const majorTotal = out.reduce((s, l) => s + l.major, 0);
  const minorTotal = out.reduce((s, l) => s + l.minor, 0);
  const totalDefects = criticalTotal + majorTotal + minorTotal;
  return {
    lines: out,
    criticalTotal,
    majorTotal,
    minorTotal,
    totalDefects,
    passQty: n(inspectionQty) - totalDefects,
    defectRatio: ratio(totalDefects, inspectionQty),
  };
}

export function checkInspection(inspectionQty, lines = []) {
  const seen = new Set();
  for (const l of lines) {
    if (seen.has(l.particular)) {
      return { field: 'inspectionLines', message: `"${l.particular}" is on the inspection report twice` };
    }
    seen.add(l.particular);
  }
  const { totalDefects } = inspectionTotals(inspectionQty, lines);
  if (totalDefects > n(inspectionQty)) {
    return {
      field: 'inspectionLines',
      message: `The inspection defects add up to ${totalDefects}, more than the ${n(inspectionQty)} pieces offered`,
    };
  }
  return null;
}

// ===========================================================================
//  SPOT RECTIFICATION - SCRAP
// ===========================================================================

/** Scrap % of Consignment = Scrap Qty / Order Qty from the Order sheet. */
export function scrapPct(scrapQty, orderQty) {
  return ratio(scrapQty, orderQty);
}

export function checkSpotRectification({ qtyReceived, soldOnlineQty, scrapQty }) {
  if (n(soldOnlineQty) + n(scrapQty) > n(qtyReceived)) {
    return {
      field: 'scrapQty',
      message: `Sold online (${n(soldOnlineQty)}) and scrapped (${n(scrapQty)}) add up to more than was received (${n(qtyReceived)})`,
    };
  }
  return null;
}

// ===========================================================================
//  RECONCILIATION REPORT
// ===========================================================================

export const RECON_MATCHED = 'Matched';
export const RECON_VARIANCE = 'Variance Found';

/**
 * Variance = Cutting Issued - Stitched - Scrap - Rejected, the sheet's own
 * formula. What is left is work in progress at the units; zero is a matched
 * order.
 *
 * Alter pieces are shown but not subtracted, exactly as the sheet does: an
 * altered piece is still a stitched piece, so taking it off again would count
 * it twice.
 */
export function reconciliationVariance({ cuttingIssued, stitched, scrap, rejected }) {
  return n(cuttingIssued) - n(stitched) - n(scrap) - n(rejected);
}

/** The status the figures suggest. The planner decides; this only proposes. */
export function suggestedReconStatus(variance) {
  return n(variance) === 0 ? RECON_MATCHED : RECON_VARIANCE;
}
