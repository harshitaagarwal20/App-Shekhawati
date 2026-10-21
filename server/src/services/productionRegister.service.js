/**
 * The registers kept after cutting - one engine, one descriptor per sheet.
 *
 * ---------------------------------------------------------------------------
 *  WHERE THEY SIT
 *
 *      Cutting Issue  ->  STITCHING RECORD / HOURLY MONITORING
 *                     ->  QC SIZE / QC DEFECTS / INTERNAL QUALITY CHECK
 *                     ->  FINAL CHECKER / FINISHED CHECKER / EXTERNAL CHECK
 *                     ->  ALTER / SPOT RECTIFICATION-SCRAP / REJECTED
 *                     ->  RECONCILIATION REPORT
 *
 *  Packing, Needle Checking and Dispatch follow, and are not built yet.
 *
 *  WHY ONE ENGINE
 *
 *  Twelve sheets, and every one of them is the same shape: a dated row against
 *  an order and its style, a few people and dropdowns, some counts typed and
 *  some worked out. What differs is which columns, which dropdown lists and
 *  which formula - so each sheet is a descriptor below, and list / get /
 *  create / update / delete are written once. A rule fixed here is fixed for
 *  all twelve.
 *
 *  WHAT EVERY REGISTER SHARES
 *
 *    - The order must exist and not be cancelled; the style must be the
 *      order's own (its header style or one of its lines). "Style No" is Auto
 *      on every sheet, so it defaults to the order's.
 *    - A dropdown value must be an active value of its Master List. A value a
 *      row already holds may be kept after it is withdrawn, never newly chosen.
 *    - Formula columns come from domain/production.js and are stored beside
 *      what was typed. Nothing posted for them is read.
 *    - Deletion is soft, so the audit trail keeps the row.
 *
 *  None of these registers moves stock.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { OPTIONS_LIMIT, searchFilter } from '../utils/http.js';
import {
  HOURLY_SLOTS,
  FINISHED_CHECKER_DEFECTS,
  alterPct,
  checkAlter,
  checkDefectsWithinChecked,
  checkExternalCheck,
  checkFinishedChecker,
  checkInternalQualityCheck,
  checkRejected,
  checkSpotRectification,
  checkStitching,
  externalCheckTotals,
  finishedCheckerTotals,
  hourlyTotal,
  reconciliationVariance,
  rejectedQty,
  scrapPct,
  stampSlots,
  stitchingRemaining,
  suggestedReconStatus,
} from '../domain/production.js';

const D = (v) => new Prisma.Decimal(v ?? 0);
const int = (v) => Math.round(Number(v ?? 0));

/** A 400 that names the form field, so the screen can mark the input. */
function fieldError(field, message) {
  return ApiError.badRequest(message, { fields: { [field]: [message] } });
}

function raise(rule) {
  if (rule) throw fieldError(rule.field, rule.message);
}

const ORDER_SELECT = {
  id: true,
  orderNo: true,
  buyer: { select: { id: true, buyerName: true } },
};
const STYLE_SELECT = { id: true, styleNo: true, styleDescription: true };
const EMP_SELECT = { id: true, empId: true, empName: true, department: true, unitLine: true };

// ===========================================================================
//  SHARED RESOLVERS
// ===========================================================================

/**
 * The order a record is kept against, with every style it carries.
 *
 * Completed orders are allowed: QC and reconciliation are often the last
 * things written against an order, after it has otherwise closed.
 */
async function resolveOrder(tx, orderId) {
  const order = await tx.buyerOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    select: {
      id: true,
      orderNo: true,
      orderQty: true,
      sizeGroup: true,
      status: true,
      styleId: true,
      lines: { where: { deletedAt: null }, select: { styleId: true, orderQty: true } },
    },
  });
  if (!order) throw fieldError('orderId', 'That order does not exist');
  if (order.status === 'CANCELLED') {
    throw ApiError.conflict(`${order.orderNo} is cancelled - nothing more can be recorded against it`);
  }
  return order;
}

/** The styles an order carries: its header style, then its lines'. */
function stylesOf(order) {
  return [...new Set([order.styleId, ...order.lines.map((l) => l.styleId)].filter(Boolean))];
}

/**
 * The style a record is for. "Style No" is Auto on every sheet: the order's
 * own style unless the order carries several and one is chosen.
 */
async function resolveStyle(tx, order, styleId) {
  if (!order) {
    if (!styleId) throw fieldError('styleId', 'Choose the style');
    const style = await tx.style.findFirst({ where: { id: styleId, deletedAt: null }, select: { id: true } });
    if (!style) throw fieldError('styleId', 'That style does not exist');
    return style.id;
  }
  const allowed = stylesOf(order);
  if (styleId) {
    if (!allowed.includes(styleId)) {
      throw fieldError('styleId', `That style is not on ${order.orderNo}`);
    }
    return styleId;
  }
  if (!allowed.length) throw fieldError('styleId', `${order.orderNo} carries no style`);
  return allowed[0];
}

/**
 * The Order sheet's quantity for one style of an order: the lines for that
 * style where the order has lines, the order's own quantity otherwise.
 */
function orderQtyFor(order, styleId) {
  const lines = order.lines.filter((l) => l.styleId === styleId);
  if (!lines.length) return D(order.orderQty);
  return lines.reduce((sum, l) => sum.plus(D(l.orderQty)), D(0));
}

async function resolveEmployee(tx, id, field, { required = false, label = 'the employee' } = {}) {
  if (!id) {
    if (required) throw fieldError(field, `Choose ${label}`);
    return null;
  }
  const emp = await tx.employee.findFirst({ where: { id, deletedAt: null }, select: EMP_SELECT });
  if (!emp) throw fieldError(field, 'That employee does not exist');
  return emp;
}

/**
 * A dropdown value checked against its Master List.
 *
 * `kept` is the value the stored row already holds: it may stay after the
 * list withdraws it, but cannot be newly chosen. One read per list, so the
 * 26-line inspection report checks its particulars in one query.
 */
async function assertInList(tx, listCode, value, field, { required = false, kept = null, label } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) throw fieldError(field, `${label ?? field} is required`);
    return;
  }
  if (kept !== null && value === kept) return;
  const values = await listValues(tx, listCode);
  if (values.has(value)) return;
  const list = await tx.masterList.findFirst({ where: { code: listCode }, select: { name: true } });
  throw fieldError(
    field,
    `"${value}" is not one of the ${list?.name ?? listCode} values. Valid values are: ${[...values].join(', ')}.`,
  );
}

async function listValues(tx, listCode) {
  const rows = await tx.masterListValue.findMany({
    where: { isActive: true, deletedAt: null, list: { code: listCode, deletedAt: null } },
    orderBy: { sortOrder: 'asc' },
    select: { value: true },
  });
  return new Set(rows.map((r) => r.value));
}

/** Input over the stored row: a key the request did not send keeps its value. */
function merged(existing, input) {
  const out = { ...(existing ?? {}) };
  for (const [k, v] of Object.entries(input)) if (v !== undefined) out[k] = v;
  return out;
}

const dateOr = (v, fallback) => (v ? new Date(v) : fallback);

/** The shared head of nearly every register: date, order, style. */
async function orderAndStyle(tx, v, { dateField = 'recordDate' } = {}) {
  const order = await resolveOrder(tx, v.orderId);
  const styleId = await resolveStyle(tx, order, v.styleId);
  return {
    order,
    head: {
      ...(dateField ? { [dateField]: dateOr(v[dateField], new Date()) } : {}),
      orderId: order.id,
      styleId,
    },
  };
}

// ===========================================================================
//  THE REGISTERS
// ===========================================================================

const BASE_INCLUDE = {
  order: { select: ORDER_SELECT },
  style: { select: STYLE_SELECT },
};

export const REGISTERS = {
  // -------------------------------------------------------------------------
  stitching: {
    path: 'stitching-records',
    module: 'STITCHING_RECORD',
    model: 'stitchingRecord',
    label: 'Stitching record',
    title: 'Stitching records',
    dateField: 'recordDate',
    sortable: ['recordDate', 'unitName', 'deliverableSize', 'actualQty', 'remainingQty', 'createdAt'],
    search: ['unitName', 'remarks', 'order.orderNo', 'style.styleNo', 'cuttingIssue.challanNo'],
    filters: ['orderId', 'styleId', 'unitName', 'cuttingIssueId'],
    include: {
      ...BASE_INCLUDE,
      cuttingIssue: { select: { id: true, challanNo: true, issueDate: true, firmName: true, cuttingPcsIssued: true } },
    },
    async build(tx, v, existing) {
      const { head } = await orderAndStyle(tx, v);

      let issue = null;
      if (v.cuttingIssueId) {
        issue = await tx.cuttingIssue.findFirst({
          where: { id: v.cuttingIssueId, deletedAt: null },
          select: { id: true, challanNo: true, orderId: true, styleId: true, firmName: true, cuttingPcsIssued: true, status: true },
        });
        if (!issue) throw fieldError('cuttingIssueId', 'That cutting issue does not exist');
        if (issue.orderId !== head.orderId) {
          throw fieldError('cuttingIssueId', `${issue.challanNo} was issued against a different order`);
        }
        if (issue.status === 'CANCELLED') throw fieldError('cuttingIssueId', `${issue.challanNo} is cancelled`);
        head.styleId = issue.styleId;
      }

      // "Unit Name" and "Deliverable Size" are Auto: the unit the challan
      // went to and the pieces it carried, unless they are stated.
      const unitName = v.unitName || issue?.firmName;
      await assertInList(tx, 'StitchingUnit', unitName, 'unitName', {
        required: true, kept: existing?.unitName ?? null, label: 'Unit Name',
      });
      const deliverableSize = v.deliverableSize ?? (issue ? int(issue.cuttingPcsIssued) : undefined);
      if (deliverableSize === undefined || deliverableSize === null) {
        throw fieldError('deliverableSize', 'Enter the deliverable size, or choose the cutting issue the pieces came on');
      }
      raise(checkStitching({ deliverableSize, actualQty: v.actualQty }));

      return {
        ...head,
        cuttingIssueId: issue?.id ?? null,
        unitName,
        deliverableSize: int(deliverableSize),
        actualQty: int(v.actualQty),
        remainingQty: stitchingRemaining(deliverableSize, v.actualQty),
        remarks: v.remarks ?? null,
      };
    },
  },

  // -------------------------------------------------------------------------
  hourly: {
    path: 'hourly-monitoring',
    module: 'HOURLY_MONITORING',
    model: 'hourlyMonitoring',
    label: 'Hourly monitoring',
    title: 'Hourly monitoring',
    dateField: 'recordDate',
    sortable: ['recordDate', 'totalPcs', 'createdAt'],
    search: ['remarks', 'order.orderNo', 'style.styleNo', 'employee.empId', 'employee.empName'],
    filters: ['orderId', 'styleId', 'employeeId'],
    include: { ...BASE_INCLUDE, employee: { select: EMP_SELECT } },
    // The slot stamps are machinery for the screen; in a spreadsheet they
    // would print as a second set of hour columns beside the counts.
    exportHide: ['slotCapturedAt'],
    async build(tx, v, existing) {
      const { head } = await orderAndStyle(tx, v);
      const emp = await resolveEmployee(tx, v.employeeId, 'employeeId', { required: true, label: 'the operator (Emp Id)' });

      // One row per operator, per order, per day: the supervisor fills its
      // slots through the day. The partial unique index holds the same rule.
      const clash = await tx.hourlyMonitoring.findFirst({
        where: {
          recordDate: head.recordDate,
          orderId: head.orderId,
          employeeId: emp.id,
          deletedAt: null,
          ...(existing ? { id: { not: existing.id } } : {}),
        },
        select: { id: true },
      });
      if (clash) {
        throw ApiError.conflict(
          `${emp.empName} already has an hourly row for this order on this day - open it and fill the next slot`,
          { id: clash.id },
        );
      }

      const slots = Object.fromEntries(HOURLY_SLOTS.map((s) => [s.key, int(v[s.key])]));
      return {
        ...head,
        employeeId: emp.id,
        ...slots,
        totalPcs: hourlyTotal(slots),
        slotCapturedAt: stampSlots(existing ?? {}, slots, existing?.slotCapturedAt ?? {}),
        remarks: v.remarks ?? null,
      };
    },
  },

  // -------------------------------------------------------------------------
  qcSize: {
    path: 'qc-size-records',
    module: 'QC_SIZE_RECORD',
    model: 'qcSizeRecord',
    label: 'QC size record',
    title: 'QC size records',
    dateField: 'recordDate',
    sortable: ['recordDate', 'unitName', 'tailorName', 'operation', 'pcsCheckedRejected', 'createdAt'],
    search: ['unitName', 'tailorName', 'operation', 'size', 'defectFound', 'informTo', 'order.orderNo', 'style.styleNo'],
    filters: ['orderId', 'styleId', 'unitName', 'tailorId'],
    include: { ...BASE_INCLUDE, tailor: { select: EMP_SELECT } },
    async build(tx, v, existing) {
      const { order, head } = await orderAndStyle(tx, v);
      const tailor = await tailorOf(tx, v);
      await assertInList(tx, 'StitchingUnit', v.unitName, 'unitName', { required: true, kept: existing?.unitName ?? null, label: 'Unit' });
      await assertInList(tx, 'Operation', v.operation, 'operation', { required: true, kept: existing?.operation ?? null, label: 'Operation' });
      await assertInList(tx, 'DefectType', v.defectFound, 'defectFound', { kept: existing?.defectFound ?? null });
      await assertInList(tx, 'InformTo', v.informTo, 'informTo', { kept: existing?.informTo ?? null });
      return {
        ...head,
        unitName: v.unitName,
        ...tailor,
        operation: v.operation,
        // "Size" is typed; the order's size group is the natural answer.
        size: v.size ?? order.sizeGroup ?? null,
        pcsCheckedRejected: int(v.pcsCheckedRejected),
        defectFound: v.defectFound ?? null,
        informTo: v.informTo ?? null,
        remarks: v.remarks ?? null,
      };
    },
  },

  // -------------------------------------------------------------------------
  qcDefect: {
    path: 'qc-defect-records',
    module: 'QC_DEFECT_RECORD',
    model: 'qcDefectRecord',
    label: 'QC defect record',
    title: 'QC defect records',
    dateField: 'recordDate',
    sortable: ['recordDate', 'unitName', 'tailorName', 'pcsCheckedRejected', 'createdAt'],
    search: ['unitName', 'tailorName', 'defectFound', 'informTo', 'order.orderNo', 'style.styleNo'],
    filters: ['orderId', 'styleId', 'unitName', 'tailorId'],
    include: { ...BASE_INCLUDE, tailor: { select: EMP_SELECT } },
    async build(tx, v, existing) {
      const { head } = await orderAndStyle(tx, v);
      const tailor = await tailorOf(tx, v);
      await assertInList(tx, 'StitchingUnit', v.unitName, 'unitName', { required: true, kept: existing?.unitName ?? null, label: 'Unit' });
      await assertInList(tx, 'DefectType', v.defectFound, 'defectFound', { kept: existing?.defectFound ?? null });
      await assertInList(tx, 'InformTo', v.informTo, 'informTo', { kept: existing?.informTo ?? null });
      return {
        ...head,
        unitName: v.unitName,
        ...tailor,
        pcsCheckedRejected: int(v.pcsCheckedRejected),
        defectFound: v.defectFound ?? null,
        informTo: v.informTo ?? null,
        remarks: v.remarks ?? null,
      };
    },
  },

  // -------------------------------------------------------------------------
  internalQc: {
    path: 'internal-quality-checks',
    module: 'INTERNAL_QUALITY_CHECK',
    model: 'internalQualityCheck',
    label: 'Internal quality check',
    title: 'Internal quality checks',
    dateField: 'recordDate',
    sortable: ['recordDate', 'unitName', 'totalPcsChecked', 'totalDefectPcs', 'qcStatus', 'createdAt'],
    search: ['unitName', 'defectType', 'qcStatus', 'transferredBackToUnit', 'remarks', 'order.orderNo', 'style.styleNo', 'checker.empId', 'checker.empName'],
    filters: ['orderId', 'styleId', 'unitName', 'checkerId', 'qcStatus'],
    include: { ...BASE_INCLUDE, checker: { select: EMP_SELECT } },
    async build(tx, v, existing) {
      const { head } = await orderAndStyle(tx, v);
      const checker = await resolveEmployee(tx, v.checkerId, 'checkerId', { required: true, label: 'the checker' });
      await assertInList(tx, 'StitchingUnit', v.unitName, 'unitName', { required: true, kept: existing?.unitName ?? null, label: 'Stitching Unit' });
      await assertInList(tx, 'DefectType', v.defectType, 'defectType', { kept: existing?.defectType ?? null });
      await assertInList(tx, 'StatusQC', v.qcStatus, 'qcStatus', { required: true, kept: existing?.qcStatus ?? null, label: 'Status' });
      await assertInList(tx, 'StitchingUnit', v.transferredBackToUnit, 'transferredBackToUnit', {
        kept: existing?.transferredBackToUnit ?? null,
      });
      raise(checkInternalQualityCheck(v));
      return {
        ...head,
        unitName: v.unitName,
        checkerId: checker.id,
        totalPcsChecked: int(v.totalPcsChecked),
        totalDefectPcs: int(v.totalDefectPcs),
        defectType: v.defectType ?? null,
        qcStatus: v.qcStatus,
        transferredBackToUnit: v.transferredBackToUnit ?? null,
        remarks: v.remarks ?? null,
      };
    },
  },

  // -------------------------------------------------------------------------
  finalChecker: {
    path: 'final-checker-reports',
    module: 'FINAL_CHECKER_REPORT',
    model: 'finalCheckerReport',
    label: 'Final checker report',
    title: 'Final checker reports',
    dateField: 'recordDate',
    sortable: ['recordDate', 'totalPcsChecked', 'totalDefect', 'createdAt'],
    search: ['defectType', 'remarks', 'order.orderNo', 'style.styleNo', 'checker.empId', 'checker.empName'],
    filters: ['orderId', 'styleId', 'checkerId'],
    include: { ...BASE_INCLUDE, checker: { select: EMP_SELECT } },
    async build(tx, v, existing) {
      // The sheet has no order column. When one is given it fills the style.
      const order = v.orderId ? await resolveOrder(tx, v.orderId) : null;
      const styleId = await resolveStyle(tx, order, v.styleId);
      const checker = await resolveEmployee(tx, v.checkerId, 'checkerId', { required: true, label: 'the checker' });
      await assertInList(tx, 'DefectType', v.defectType, 'defectType', { kept: existing?.defectType ?? null });
      raise(checkDefectsWithinChecked(v.totalPcsChecked, v.totalDefect, 'totalDefect'));
      return {
        recordDate: dateOr(v.recordDate, new Date()),
        orderId: order?.id ?? null,
        styleId,
        checkerId: checker.id,
        totalPcsChecked: int(v.totalPcsChecked),
        totalDefect: int(v.totalDefect),
        defectType: v.defectType ?? null,
        remarks: v.remarks ?? null,
      };
    },
  },

  // -------------------------------------------------------------------------
  finishedChecker: {
    path: 'finished-checker-records',
    module: 'FINISHED_CHECKER',
    model: 'finishedCheckerRecord',
    label: 'Finished checker record',
    title: 'Finished checker records',
    dateField: 'recordDate',
    sortable: ['recordDate', 'checkedPcs', 'totalDefects', 'piecesPassed', 'defectPct', 'createdAt'],
    search: ['remarks', 'order.orderNo', 'style.styleNo', 'checker.empId', 'checker.empName'],
    filters: ['orderId', 'styleId', 'checkerId'],
    include: { ...BASE_INCLUDE, checker: { select: EMP_SELECT } },
    async build(tx, v) {
      const { head } = await orderAndStyle(tx, v);
      const checker = await resolveEmployee(tx, v.checkerId, 'checkerId', { required: true, label: 'the checker' });
      const counts = Object.fromEntries(FINISHED_CHECKER_DEFECTS.map((d) => [d.key, int(v[d.key])]));
      raise(checkFinishedChecker(v.checkedPcs, counts));
      const totals = finishedCheckerTotals(v.checkedPcs, counts);
      return {
        ...head,
        checkerId: checker.id,
        checkedPcs: int(v.checkedPcs),
        ...counts,
        totalDefects: totals.totalDefects,
        piecesPassed: totals.piecesPassed,
        defectPct: D(totals.defectPct),
        remarks: v.remarks ?? null,
      };
    },
  },

  // -------------------------------------------------------------------------
  externalCheck: {
    path: 'external-secondary-checks',
    module: 'EXTERNAL_SECONDARY_CHECK',
    model: 'externalSecondaryCheck',
    label: 'External secondary check',
    title: 'External secondary checks',
    dateField: 'recordDate',
    sortable: ['recordDate', 'inspectionQty', 'totalDefects', 'passQty', 'defectRatio', 'createdAt'],
    search: ['agencyName', 'personIncharge', 'remarks', 'order.orderNo', 'style.styleNo'],
    filters: ['orderId', 'styleId'],
    include: { ...BASE_INCLUDE, lines: { orderBy: { lineNo: 'asc' } } },
    hasLines: true,
    async build(tx, v, existing) {
      const { head } = await orderAndStyle(tx, v);
      const lines = v.lines ?? existing?.lines ?? [];
      const allowed = await listValues(tx, 'InspDefect26');
      const kept = new Set((existing?.lines ?? []).map((l) => l.particular));
      for (const l of lines) {
        if (!allowed.has(l.particular) && !kept.has(l.particular)) {
          throw fieldError('lines', `"${l.particular}" is not one of the inspection defects (L_InspDefect26)`);
        }
      }
      raise(checkExternalCheck(v.inspectionQty, lines));
      const totals = externalCheckTotals(v.inspectionQty, lines);
      return {
        data: {
          ...head,
          agencyName: v.agencyName ?? null,
          personIncharge: v.personIncharge ?? null,
          inspectionQty: int(v.inspectionQty),
          criticalTotal: totals.criticalTotal,
          majorTotal: totals.majorTotal,
          minorTotal: totals.minorTotal,
          totalDefects: totals.totalDefects,
          passQty: totals.passQty,
          defectRatio: D(totals.defectRatio),
          remarks: v.remarks ?? null,
        },
        lines: totals.lines.map((l, i) => ({
          lineNo: i + 1,
          particular: l.particular,
          critical: l.critical,
          major: l.major,
          minor: l.minor,
          total: l.total,
          remark: l.remark ?? null,
        })),
      };
    },
  },

  // -------------------------------------------------------------------------
  alter: {
    path: 'alter-reports',
    module: 'ALTER_REPORT',
    model: 'alterReport',
    label: 'Alter report',
    title: 'Alter reports',
    dateField: 'capturedAt',
    sortable: ['capturedAt', 'outputPcs', 'passPcs', 'alterPcs', 'alterPct', 'createdAt'],
    search: ['remarks', 'order.orderNo', 'style.styleNo'],
    filters: ['orderId', 'styleId'],
    include: BASE_INCLUDE,
    async build(tx, v, existing) {
      const { head } = await orderAndStyle(tx, v, { dateField: null });
      raise(checkAlter(v));
      return {
        ...head,
        // "Time - Auto Capture, trigger on submit button". Stamped when the
        // record is first saved and kept through later corrections.
        capturedAt: existing?.capturedAt ?? new Date(),
        outputPcs: int(v.outputPcs),
        passPcs: int(v.passPcs),
        alterPcs: int(v.alterPcs),
        alterPct: D(alterPct(v.outputPcs, v.alterPcs)),
        remarks: v.remarks ?? null,
      };
    },
  },

  // -------------------------------------------------------------------------
  spotRectification: {
    path: 'spot-rectifications',
    module: 'SPOT_RECTIFICATION',
    model: 'spotRectification',
    label: 'Spot rectification',
    title: 'Spot rectification & scrap',
    dateField: 'recordDate',
    sortable: ['recordDate', 'qtyReceived', 'soldOnlineQty', 'scrapQty', 'scrapPct', 'createdAt'],
    search: ['authorisedBy', 'remarks', 'order.orderNo', 'style.styleNo'],
    filters: ['orderId', 'styleId'],
    include: BASE_INCLUDE,
    async build(tx, v, existing) {
      const { order, head } = await orderAndStyle(tx, v);
      await assertInList(tx, 'AuthorisedBy', v.authorisedBy, 'authorisedBy', { kept: existing?.authorisedBy ?? null });
      raise(checkSpotRectification(v));
      const orderQty = orderQtyFor(order, head.styleId);
      return {
        ...head,
        qtyReceived: int(v.qtyReceived),
        soldOnlineQty: int(v.soldOnlineQty),
        scrapQty: int(v.scrapQty),
        orderQty,
        scrapPct: D(scrapPct(v.scrapQty, orderQty)),
        authorisedBy: v.authorisedBy ?? null,
        remarks: v.remarks ?? null,
      };
    },
  },

  // -------------------------------------------------------------------------
  rejected: {
    path: 'rejected-records',
    module: 'REJECTED_RECORD',
    model: 'rejectedRecord',
    label: 'Rejected record',
    title: 'Rejected records',
    dateField: 'recordDate',
    sortable: ['recordDate', 'cuttingQty', 'packedQty', 'rejectedQty', 'createdAt'],
    search: ['checkedByName', 'rejectReason', 'remarks', 'order.orderNo', 'style.styleNo'],
    filters: ['orderId', 'styleId', 'rejectReason'],
    include: { ...BASE_INCLUDE, checkedBy: { select: EMP_SELECT } },
    async build(tx, v, existing) {
      const { order, head } = await orderAndStyle(tx, v);
      const checker = await resolveEmployee(tx, v.checkedById, 'checkedById');
      await assertInList(tx, 'RejectReason', v.rejectReason, 'rejectReason', { kept: existing?.rejectReason ?? null });

      // "Cutting Qty - from Cutting Issue": offered from the issues, and
      // stated when the floor's count differs.
      const cuttingQty = v.cuttingQty ?? (await figuresFor(tx, head.orderId, head.styleId)).cuttingIssued;
      raise(checkRejected({ cuttingQty, packedQty: v.packedQty }));

      return {
        ...head,
        orderQty: orderQtyFor(order, head.styleId),
        cuttingQty: int(cuttingQty),
        packedQty: int(v.packedQty),
        rejectedQty: rejectedQty(cuttingQty, v.packedQty),
        checkedById: checker?.id ?? null,
        checkedByName: checker?.empName ?? v.checkedByName ?? null,
        rejectReason: v.rejectReason ?? null,
        remarks: v.remarks ?? null,
      };
    },
  },

  // -------------------------------------------------------------------------
  reconciliation: {
    path: 'reconciliation-reports',
    module: 'RECONCILIATION_REPORT',
    model: 'reconciliationReport',
    label: 'Reconciliation report',
    title: 'Reconciliation reports',
    dateField: null,
    sortable: ['reconStatus', 'createdAt', 'updatedAt'],
    defaultSort: 'updatedAt',
    search: ['reconStatus', 'remarks', 'order.orderNo', 'style.styleNo'],
    filters: ['orderId', 'styleId', 'reconStatus'],
    include: BASE_INCLUDE,
    async build(tx, v, existing) {
      const { head } = await orderAndStyle(tx, v, { dateField: null });
      const clash = await tx.reconciliationReport.findFirst({
        where: {
          orderId: head.orderId,
          styleId: head.styleId,
          deletedAt: null,
          ...(existing ? { id: { not: existing.id } } : {}),
        },
        select: { id: true },
      });
      if (clash) {
        throw ApiError.conflict('This order and style already has a reconciliation report - open it instead', {
          id: clash.id,
        });
      }
      // Status is the planner's call; the figures only propose one.
      const reconStatus = v.reconStatus
        ?? suggestedReconStatus((await figuresFor(tx, head.orderId, head.styleId)).variance);
      await assertInList(tx, 'StatusRecon', reconStatus, 'reconStatus', {
        required: true, kept: existing?.reconStatus ?? null, label: 'Status',
      });
      return { ...head, reconStatus, remarks: v.remarks ?? null };
    },
    /** Every count on the sheet is Auto, so it is read fresh on every view. */
    async enrich(rows) {
      const figures = await figuresForMany(prisma, rows.map((r) => ({ orderId: r.orderId, styleId: r.styleId })));
      return rows.map((r) => ({ ...r, figures: figures.get(`${r.orderId}:${r.styleId}`) }));
    },
  },
};

/** "Tailor Name": picked from Employees when on the master, typed otherwise. */
async function tailorOf(tx, v) {
  const emp = await resolveEmployee(tx, v.tailorId, 'tailorId');
  const tailorName = emp?.empName ?? v.tailorName;
  if (!tailorName) throw fieldError('tailorId', 'Choose the tailor, or type the name');
  return { tailorId: emp?.id ?? null, tailorName };
}

// ===========================================================================
//  RECONCILIATION FIGURES
// ===========================================================================

/**
 * What the registers say about one order and style - the Reconciliation
 * Report's Auto columns:
 *
 *   Cutting Pcs Issued      Cutting Issue (not cancelled)
 *   Stitched Pcs Received   Stiching Record, Actual
 *   Alter Pcs               Alter Report, Alter piece
 *   Scrap Pcs               Spot Rectification-Scrap, Scrap Qty
 *   Rejected Pcs            Rejected, Rejected Qty
 *   Packed Pcs              Rejected, Packed Qty - until Packing is built,
 *                           the only place a packed count is written down
 *   Variance                Cutting - Stitched - Scrap - Rejected
 */
export async function figuresFor(db, orderId, styleId) {
  const map = await figuresForMany(db, [{ orderId, styleId }]);
  return map.get(`${orderId}:${styleId}`);
}

async function figuresForMany(db, pairs) {
  const orderIds = [...new Set(pairs.map((p) => p.orderId))];
  const where = { orderId: { in: orderIds }, deletedAt: null };
  const by = ['orderId', 'styleId'];
  const [cut, stitched, alter, scrap, rejected] = await Promise.all([
    db.cuttingIssue.groupBy({ by, where: { ...where, status: { not: 'CANCELLED' } }, _sum: { cuttingPcsIssued: true } }),
    db.stitchingRecord.groupBy({ by, where, _sum: { actualQty: true } }),
    db.alterReport.groupBy({ by, where, _sum: { alterPcs: true } }),
    db.spotRectification.groupBy({ by, where, _sum: { scrapQty: true } }),
    db.rejectedRecord.groupBy({ by, where, _sum: { rejectedQty: true, packedQty: true } }),
  ]);
  const pick = (rows, p, field) => {
    const hit = rows.find((r) => r.orderId === p.orderId && r.styleId === p.styleId);
    return Number(hit?._sum?.[field] ?? 0);
  };
  const out = new Map();
  for (const p of pairs) {
    const f = {
      cuttingIssued: pick(cut, p, 'cuttingPcsIssued'),
      stitched: pick(stitched, p, 'actualQty'),
      alter: pick(alter, p, 'alterPcs'),
      scrap: pick(scrap, p, 'scrapQty'),
      rejected: pick(rejected, p, 'rejectedQty'),
      packed: pick(rejected, p, 'packedQty'),
    };
    f.variance = reconciliationVariance(f);
    f.suggestedStatus = suggestedReconStatus(f.variance);
    out.set(`${p.orderId}:${p.styleId}`, f);
  }
  return out;
}

// ===========================================================================
//  THE ENGINE
// ===========================================================================

function registerOf(key) {
  const reg = REGISTERS[key];
  if (!reg) throw ApiError.notFound('Register');
  return reg;
}

export function sortableOf(key) {
  return registerOf(key).sortable;
}

export function defaultSortOf(key) {
  const reg = registerOf(key);
  return reg.defaultSort ?? reg.dateField ?? 'createdAt';
}

export async function list(key, query) {
  const reg = registerOf(key);
  const { page, pageSize, skip, take, orderBy, search, includeDeleted, dateFrom, dateTo } = query;

  const where = {
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...Object.fromEntries(reg.filters.filter((f) => query[f]).map((f) => [f, query[f]])),
    ...(reg.dateField && (dateFrom || dateTo)
      ? {
          [reg.dateField]: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
    ...searchFilter(search, reg.search),
  };

  const delegate = prisma[reg.model];
  const [rows, total] = await Promise.all([
    delegate.findMany({ where, orderBy, skip, take, include: reg.include }),
    delegate.count({ where }),
  ]);

  return { rows: reg.enrich ? await reg.enrich(rows) : rows, total, page, pageSize };
}

export async function getById(key, id) {
  const reg = registerOf(key);
  const row = await prisma[reg.model].findFirst({ where: { id, deletedAt: null }, include: reg.include });
  if (!row) throw ApiError.notFound(reg.label);
  return reg.enrich ? (await reg.enrich([row]))[0] : row;
}

export async function create(key, input, actor = {}) {
  const reg = registerOf(key);
  const id = await prisma.$transaction(async (tx) => {
    const built = await reg.build(tx, merged(null, input), null);
    const { data, lines } = reg.hasLines ? built : { data: built };
    const row = await tx[reg.model].create({
      data: {
        ...data,
        ...(lines ? { lines: { create: lines } } : {}),
        createdById: actor.userId ?? null,
        updatedById: actor.userId ?? null,
      },
      select: { id: true },
    });
    return row.id;
  });
  return getById(key, id);
}

export async function update(key, id, input, actor = {}) {
  const reg = registerOf(key);
  await prisma.$transaction(async (tx) => {
    const existing = await tx[reg.model].findFirst({
      where: { id, deletedAt: null },
      ...(reg.hasLines ? { include: { lines: { orderBy: { lineNo: 'asc' } } } } : {}),
    });
    if (!existing) throw ApiError.notFound(reg.label);

    const built = await reg.build(tx, merged(existing, input), existing);
    const { data, lines } = reg.hasLines ? built : { data: built };
    if (lines) await tx.externalSecondaryCheckLine.deleteMany({ where: { checkId: id } });
    await tx[reg.model].update({
      where: { id },
      data: {
        ...data,
        ...(lines ? { lines: { create: lines } } : {}),
        updatedById: actor.userId ?? null,
      },
    });
  });
  return getById(key, id);
}

/** Soft delete - the row stays for the audit trail. */
export async function remove(key, id, actorId) {
  const reg = registerOf(key);
  const existing = await prisma[reg.model].findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!existing) throw ApiError.notFound(reg.label);
  await prisma[reg.model].update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: actorId ?? null },
  });
  return { id, deleted: true };
}

// ===========================================================================
//  LOOKUPS - what the forms need, without the masters' own permissions
// ===========================================================================

/**
 * Orders a register may be kept against: every order not cancelled,
 * completed ones included - QC and reconciliation outlive production.
 */
export async function orderOptions() {
  return prisma.buyerOrder.findMany({
    where: { deletedAt: null, status: { not: 'CANCELLED' } },
    orderBy: { orderDate: 'desc' },
    take: OPTIONS_LIMIT,
    select: {
      id: true,
      orderNo: true,
      orderQty: true,
      sizeGroup: true,
      colorCode: true,
      status: true,
      buyer: { select: { id: true, buyerName: true } },
      style: { select: STYLE_SELECT },
    },
  });
}

/**
 * Active styles, for the one sheet with no order column - the Final Checker
 * Report names a style and nothing else.
 */
export async function styleOptions() {
  return prisma.style.findMany({
    where: { deletedAt: null, status: 'ACTIVE' },
    orderBy: { styleNo: 'asc' },
    take: OPTIONS_LIMIT,
    select: STYLE_SELECT,
  });
}

/** Active employees - tailors, operators and checkers are all on the master. */
export async function employeeOptions() {
  return prisma.employee.findMany({
    where: { deletedAt: null, status: 'ACTIVE' },
    orderBy: { empId: 'asc' },
    take: OPTIONS_LIMIT,
    select: EMP_SELECT,
  });
}

/**
 * Everything a form fills in from the order once it is chosen: the styles it
 * carries (with the Order sheet quantity of each), the cutting issues that
 * sent its pieces out, and the reconciliation figures per style.
 */
export async function orderContext(orderId) {
  const order = await prisma.buyerOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    select: {
      id: true,
      orderNo: true,
      orderQty: true,
      sizeGroup: true,
      colorCode: true,
      styleId: true,
      buyer: { select: { id: true, buyerName: true } },
      lines: { where: { deletedAt: null }, select: { styleId: true, orderQty: true } },
    },
  });
  if (!order) throw ApiError.notFound('Order');

  const styleIds = stylesOf(order);
  const [styleRows, issues, figures] = await Promise.all([
    prisma.style.findMany({ where: { id: { in: styleIds } }, select: STYLE_SELECT }),
    prisma.cuttingIssue.findMany({
      where: { orderId, deletedAt: null, status: { not: 'CANCELLED' } },
      orderBy: { issueDate: 'asc' },
      select: { id: true, challanNo: true, issueDate: true, firmName: true, styleId: true, cuttingPcsIssued: true, containerNo: true },
    }),
    figuresForMany(prisma, styleIds.map((styleId) => ({ orderId, styleId }))),
  ]);

  const { lines: _lines, ...head } = order;
  return {
    order: head,
    styles: styleIds
      .map((id) => styleRows.find((s) => s.id === id))
      .filter(Boolean)
      .map((s) => ({
        ...s,
        orderQty: orderQtyFor(order, s.id).toString(),
        figures: figures.get(`${orderId}:${s.id}`),
      })),
    cuttingIssues: issues,
  };
}
