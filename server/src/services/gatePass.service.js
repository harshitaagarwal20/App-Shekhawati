/**
 * Gate Pass. Sheet: "Gate Pass (Inward / Outward)"
 * (Role Acess - Procurement Dept (Checker)).
 *
 * A gate pass is the only document in this system that describes a physical
 * event: goods crossing the factory gate. Everything about it follows from
 * that.
 *
 * ---------------------------------------------------------------------------
 *  IT IS ALWAYS ABOUT SOMETHING ELSE
 *
 *  The sheet's "Linked PO / Challan No" column holds RF-001, DY-001, CH-001 -
 *  a purchase order, a job-work issue, a cutting challan. A gate pass that
 *  names nothing is a gate pass nobody can audit, so the reference is required
 *  and RESOLVED: `resolveReference()` finds the real document behind the number
 *  and stores the foreign key beside the text. The printed number stays exactly
 *  as the sheet holds it; the link is what makes the pipeline traceable.
 *
 *  VARIATION % IS A SERVER FORMULA
 *
 *      variationPct = (qty - receivedQty) / qty          [Excel: IFERROR(..., 0)]
 *
 *  Positive means short delivery, negative means over. `variationPct` is in no
 *  input schema - Zod strips it - is recomputed on every write, and a CHECK
 *  constraint refuses a row where it disagrees with the two quantities.
 *
 *  QTY COMES FROM THE LINKED DOCUMENT
 *
 *  The sheet marks Qty "(Auto - from the linked document)". So it is: the
 *  expected quantity is read off the PO's outstanding balance rather than
 *  typed, and a gate pass that claims more than the PO still expects is
 *  refused. Received Qty is the one quantity a checker actually keys, because
 *  it is the one thing only a person at the gate can know.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError, ERROR_CODES } from '../utils/ApiError.js';
import { OPTIONS_LIMIT, searchFilter } from '../utils/http.js';
import { assertValueInList } from './masterList.service.js';
import { nextNumber, peekNumber } from './documentNumber.service.js';
import * as engine from './approvalEngine.js';

export const SORTABLE = [
  'gatePassNo',
  'gatePassDate',
  'type',
  'linkedDocNo',
  'item',
  'qty',
  'receivedQty',
  'variationPct',
  'status',
  'createdAt',
];

const SEARCH = ['gatePassNo', 'linkedDocNo', 'item', 'partyName', 'authorisedBy', 'vehicleNo', 'driverName', 'remarks'];

const D = (v) => new Prisma.Decimal(v ?? 0);
const ZERO = D(0);

const INCLUDE = {
  vendor: {
    select: {
      id: true,
      vendorCode: true,
      vendorName: true,
      category: true,
      address: true,
      gstNo: true,
      phone: true,
      contactPerson: true,
    },
  },
  authorisedEmployee: {
    select: { id: true, empId: true, empName: true, department: true, designation: true },
  },
  purchaseOrder: {
    select: {
      id: true,
      poId: true,
      poDate: true,
      item: true,
      subCategory: true,
      accessoriesItem: true,
      uom: true,
      orderQty: true,
      receivedQty: true,
      rate: true,
      amount: true,
      status: true,
      approvalStatus: true,
      vendor: { select: { id: true, vendorName: true } },
      order: { select: { id: true, orderNo: true } },
      quotation: { select: { id: true, quotationNo: true } },
    },
  },
  dyeIssue: {
    select: {
      id: true,
      dyeIssueNo: true,
      issueDate: true,
      process: true,
      qty: true,
      uom: true,
      roll: { select: { id: true, rollNo: true, fabricName: true } },
    },
  },
  cuttingIssue: {
    select: {
      id: true,
      challanNo: true,
      issueDate: true,
      firmName: true,
      cuttingPcsIssued: true,
    },
  },
};

const LIST_INCLUDE = {
  vendor: { select: { id: true, vendorName: true } },
  purchaseOrder: { select: { id: true, poId: true } },
  authorisedEmployee: { select: { id: true, empName: true } },
};

// ===========================================================================
//  CALCULATION - the single place a variation is derived
// ===========================================================================

/**
 * Excel: "Variation %" = IFERROR((Qty - Received Qty) / Qty, 0).
 *
 * Rounded to 6 decimals, the scale the column stores. Positive is a shortfall,
 * negative is an excess - the sheet's own sign convention, kept rather than
 * "corrected", so a printed gate pass reads the way the office expects.
 *
 * @param {Prisma.Decimal|string|number} qty
 * @param {Prisma.Decimal|string|number|null|undefined} receivedQty
 * @returns {Prisma.Decimal}
 */
export function calculateVariation(qty, receivedQty) {
  const expected = D(qty);
  if (expected.isZero() || receivedQty === null || receivedQty === undefined) return ZERO;
  return expected
    .minus(D(receivedQty))
    .div(expected)
    .toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
}

// ===========================================================================
//  THE REFERENCE DOCUMENT
// ===========================================================================

/**
 * Finds the document a gate pass is raised against.
 *
 * The sheet writes a bare number. Three document types can appear there, so all
 * three are tried, and the result carries both the resolved foreign key and
 * everything the gate pass can legitimately copy from it - the party, the
 * expected quantity, the UOM, the item.
 *
 * A number that resolves to nothing is refused. The alternative is a gate pass
 * that references a typo, which is the same as referencing nothing.
 */
export async function resolveReference(linkedDocNo, { type } = {}) {
  const docNo = linkedDocNo.trim();

  const po = await prisma.purchaseOrder.findFirst({
    where: { poId: docNo, deletedAt: null },
    include: {
      vendor: { select: { id: true, vendorName: true, address: true } },
      order: { select: { id: true, orderNo: true } },
    },
  });
  if (po) {
    if (po.approvalStatus !== 'APPROVED') {
      throw ApiError.conflict(
        `PO ${po.poId} is ${po.approvalStatus.toLowerCase()}. Goods cannot pass the gate against ` +
          'a purchase order that has not been approved.',
        { field: 'linkedDocNo', approvalStatus: po.approvalStatus },
      );
    }
    const outstanding = D(po.orderQty).minus(D(po.receivedQty));
    return {
      kind: 'PURCHASE_ORDER',
      purchaseOrderId: po.id,
      dyeIssueId: null,
      cuttingIssueId: null,
      document: po,
      vendorId: po.vendorId,
      partyName: po.vendor.vendorName,
      item:
        po.accessoriesItem ??
        [po.item, po.subCategory].filter(Boolean).join(' ') ??
        po.item,
      uom: po.uom,
      /** What the PO is still waiting for - the sheet's "Auto" quantity. */
      expectedQty: (outstanding.isNegative() ? ZERO : outstanding).toFixed(4),
      documentQty: D(po.orderQty).toFixed(4),
      orderNo: po.order?.orderNo ?? null,
      /** Inward, because a PO brings goods in. */
      naturalType: 'INWARD',
    };
  }

  const dyeIssue = await prisma.dyeIssue.findFirst({
    where: { dyeIssueNo: docNo, deletedAt: null },
    include: {
      vendor: { select: { id: true, vendorName: true } },
      roll: { select: { rollNo: true, fabricName: true } },
    },
  });
  if (dyeIssue) {
    return {
      kind: 'DYE_ISSUE',
      purchaseOrderId: null,
      dyeIssueId: dyeIssue.id,
      cuttingIssueId: null,
      document: dyeIssue,
      vendorId: dyeIssue.vendorId,
      partyName: dyeIssue.vendor?.vendorName ?? null,
      item: dyeIssue.roll?.fabricName ?? 'Fabric',
      uom: dyeIssue.uom,
      expectedQty: D(dyeIssue.qty).toFixed(4),
      documentQty: D(dyeIssue.qty).toFixed(4),
      orderNo: null,
      // A job-work issue sends goods out, and the same number brings them back.
      naturalType: type ?? 'OUTWARD',
    };
  }

  const cuttingIssue = await prisma.cuttingIssue.findFirst({
    where: { challanNo: docNo, deletedAt: null },
  });
  if (cuttingIssue) {
    return {
      kind: 'CUTTING_ISSUE',
      purchaseOrderId: null,
      dyeIssueId: null,
      cuttingIssueId: cuttingIssue.id,
      document: cuttingIssue,
      vendorId: null,
      partyName: cuttingIssue.firmName ?? null,
      item: 'Cutting Pieces',
      // The Cutting Issue sheet counts in pieces and carries no UOM column.
      uom: 'Pcs',
      expectedQty: D(cuttingIssue.cuttingPcsIssued).toFixed(4),
      documentQty: D(cuttingIssue.cuttingPcsIssued).toFixed(4),
      orderNo: null,
      naturalType: type ?? 'OUTWARD',
    };
  }

  throw ApiError.badRequest(
    `No purchase order, job-work issue or cutting challan is numbered ${docNo}. ` +
      'A gate pass must reference a document that exists.',
    { field: 'linkedDocNo' },
  );
}

// ===========================================================================
//  VALIDATION HELPERS
// ===========================================================================

async function validateDropdowns(data) {
  if (data.item !== undefined && data.item !== null) {
    // "Item" on this sheet is free text ("Dyed Fabric", "Cut Panels"), not a
    // list value - the workbook's own sample rows prove it. Nothing to check.
  }
  if (data.uom !== undefined) await assertValueInList('UOM', data.uom, { field: 'uom' });
}

/** The employee who authorised the pass, where a real employee is named. */
async function resolveAuthoriser(authorisedEmployeeId, authorisedBy) {
  if (!authorisedEmployeeId) {
    // The sheet also prints titles from L_AuthorisedBy ("Dinesh Sir") which are
    // not Employee Master rows. Those are kept as a name and nothing more.
    if (authorisedBy) {
      await assertValueInListOrEmployee(authorisedBy);
    }
    return null;
  }
  const employee = await prisma.employee.findFirst({
    where: { id: authorisedEmployeeId, deletedAt: null },
  });
  if (!employee) {
    throw ApiError.badRequest('Employee does not exist', { field: 'authorisedEmployeeId' });
  }
  if (employee.status !== 'ACTIVE') {
    throw ApiError.badRequest(
      `${employee.empName} is inactive and cannot authorise a gate pass`,
      { field: 'authorisedEmployeeId' },
    );
  }
  return employee;
}

/**
 * "Authorised By" is either a name on the L_AuthorisedBy list or the name of an
 * employee. Anything else is a typo, and a gate pass authorised by a typo is a
 * gate pass authorised by nobody.
 */
async function assertValueInListOrEmployee(name) {
  const [listed, employee] = await Promise.all([
    prisma.masterListValue.findFirst({
      where: {
        value: name,
        isActive: true,
        deletedAt: null,
        list: { code: 'AuthorisedBy', deletedAt: null },
      },
      select: { id: true },
    }),
    prisma.employee.findFirst({
      where: { empName: name, deletedAt: null, status: 'ACTIVE' },
      select: { id: true },
    }),
  ]);
  if (!listed && !employee) {
    throw ApiError.badRequest(
      `"${name}" is neither a value of the AuthorisedBy list nor an active employee`,
      { field: 'authorisedBy' },
    );
  }
}

/** Counts what has been raised against a gate pass. */
async function downstreamUsage(gatePassId) {
  const grns = await prisma.grn.count({ where: { gatePassId, deletedAt: null } });
  return { grns, total: grns };
}

/** Explains, in one place, whether and how a gate pass may be changed. */
function editability(gp, usage) {
  const cleared = gp.status === 'CLEARED';
  return {
    canEdit: !cleared && usage.total === 0,
    canClear: !cleared,
    canReopen: cleared && usage.total === 0,
    canDelete: !cleared && usage.total === 0,
    /** A GRN is raised on an inward pass once the goods are actually in. */
    canRaiseGrn: gp.type === 'INWARD' && Boolean(gp.purchaseOrderId),
    lockedBy: usage.grns > 0 ? [`${usage.grns} GRN(s)`] : [],
  };
}

// ===========================================================================
//  PROJECTION
// ===========================================================================

function project(gp) {
  if (!gp) return gp;
  const qty = D(gp.qty);
  const received = gp.receivedQty === null ? null : D(gp.receivedQty);
  const variation = D(gp.variationPct);
  return {
    ...gp,
    variationCalculation:
      received === null
        ? 'awaiting a received quantity'
        : `(${qty.toFixed(4)} - ${received.toFixed(4)}) / ${qty.toFixed(4)}`,
    variationPctDisplay: variation.mul(100).toDecimalPlaces(2).toFixed(2),
    shortQty: received === null ? null : qty.minus(received).toFixed(4),
    /** The sheet's sign convention, spelled out so no screen has to guess. */
    variationDirection:
      received === null ? null : variation.isZero() ? 'EXACT' : variation.isPositive() ? 'SHORT' : 'EXCESS',
    cleared: gp.status === 'CLEARED',
  };
}

// ===========================================================================
//  QUERIES
// ===========================================================================

export async function list(query) {
  const {
    page, pageSize, skip, take, orderBy, search, includeDeleted,
    type, status, purpose, vendorId, purchaseOrderId, linkedDocNo, dateFrom, dateTo, withVariation,
  } = query;

  const where = {
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(type ? { type } : {}),
    ...(status ? { status } : {}),
    ...(purpose ? { purpose } : {}),
    ...(vendorId ? { vendorId } : {}),
    ...(purchaseOrderId ? { purchaseOrderId } : {}),
    ...(linkedDocNo ? { linkedDocNo } : {}),
    ...(dateFrom || dateTo
      ? {
          gatePassDate: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(dateTo) } : {}),
          },
        }
      : {}),
    // "Show me the deliveries that did not match" - the checker's daily job.
    ...(withVariation ? { NOT: { variationPct: 0 } } : {}),
    ...searchFilter(search, SEARCH),
  };

  const [rows, total] = await Promise.all([
    prisma.gatePass.findMany({ where, orderBy, skip, take, include: LIST_INCLUDE }),
    prisma.gatePass.count({ where }),
  ]);

  return { rows: rows.map(project), total, page, pageSize };
}

export async function getById(id) {
  const gp = await prisma.gatePass.findFirst({
    where: { id, deletedAt: null },
    include: INCLUDE,
  });
  if (!gp) throw ApiError.notFound('Gate pass');

  const [usage, grns] = await Promise.all([
    downstreamUsage(id),
    prisma.grn.findMany({
      where: { gatePassId: id, deletedAt: null },
      orderBy: { grnDate: 'asc' },
      select: {
        id: true,
        grnNo: true,
        grnDate: true,
        billNo: true,
        receivingQty: true,
        amount: true,
        status: true,
        postedAt: true,
      },
    }),
  ]);

  return {
    ...project(gp),
    reference: referenceOf(gp),
    grns,
    usage,
    editable: editability(gp, usage),
  };
}

/**
 * The document this pass is against, whichever of the three it turned out to
 * be, in one shape the screens can render without branching three ways.
 */
function referenceOf(gp) {
  if (gp.purchaseOrder) {
    const po = gp.purchaseOrder;
    return {
      kind: 'PURCHASE_ORDER',
      id: po.id,
      no: po.poId,
      date: po.poDate,
      qty: po.orderQty,
      receivedQty: po.receivedQty,
      uom: po.uom,
      party: po.vendor?.vendorName ?? null,
      status: po.status,
      approvalStatus: po.approvalStatus,
      route: `/purchase-orders/${po.id}`,
      chain: [po.order?.orderNo, po.quotation?.quotationNo, po.poId].filter(Boolean).join(' → '),
    };
  }
  if (gp.dyeIssue) {
    return {
      kind: 'DYE_ISSUE',
      id: gp.dyeIssue.id,
      no: gp.dyeIssue.dyeIssueNo,
      date: gp.dyeIssue.issueDate,
      qty: gp.dyeIssue.qty,
      uom: gp.dyeIssue.uom,
      party: null,
      route: null,
      chain: gp.dyeIssue.dyeIssueNo,
    };
  }
  if (gp.cuttingIssue) {
    return {
      kind: 'CUTTING_ISSUE',
      id: gp.cuttingIssue.id,
      no: gp.cuttingIssue.challanNo,
      date: gp.cuttingIssue.issueDate,
      qty: gp.cuttingIssue.cuttingPcsIssued,
      uom: 'Pcs',
      party: gp.cuttingIssue.firmName,
      route: null,
      chain: gp.cuttingIssue.challanNo,
    };
  }
  return {
    kind: 'UNRESOLVED',
    no: gp.linkedDocNo,
    chain: gp.linkedDocNo,
    note:
      'This gate pass names a document the system could not resolve. It was most likely ' +
      'recorded before that document existed here.',
  };
}

// ===========================================================================
//  COMMANDS
// ===========================================================================

/**
 * Raises a gate pass.
 *
 * The reference is resolved first, because almost everything else on the pass
 * is copied from it: the party, the expected quantity, the UOM. What the
 * checker actually supplies is the type, the purpose, who authorised it, and -
 * if the goods are already counted - the received quantity.
 */
export async function create(input, actorId) {
  await validateDropdowns(input);

  /*
   * TWO WAYS TO RAISE A PASS, AND THE GATE GETS THE SHORT ONE.
   *
   * Naming a document is still supported and still fills everything from it.
   * But goods coming IN arrive before anybody has matched them to an order,
   * and the checker at the gate knows only who delivered and when. Requiring
   * the document there meant the pass was written up later from memory - the
   * exact problem `movementTime` exists to record - or a number was guessed.
   *
   * So an inward pass with no `linkedDocNo` is raised on the vendor and the
   * time alone, and `allocate()` attaches the document afterwards.
   *
   * Outward is not offered the short form: goods leaving the building without
   * a record of where they are going is a worse problem than an unmatched
   * delivery, and the person sending them out DOES know the document.
   */
  const unallocated = !input.linkedDocNo?.trim();

  if (unallocated && input.type !== 'INWARD') {
    throw ApiError.badRequest(
      'An outward gate pass must name the purchase order, job work or cutting challan the '
      + 'goods are leaving against.',
      { field: 'linkedDocNo' },
    );
  }
  if (unallocated && !input.vendorId && !input.partyName?.trim()) {
    throw ApiError.badRequest(
      'Say who delivered. A pass raised without a document is identified by the vendor it came '
      + 'from and the time it arrived, so one of those cannot be missing too.',
      { field: 'vendorId' },
    );
  }

  const reference = unallocated
    ? null
    : await resolveReference(input.linkedDocNo, { type: input.type });
  const employee = await resolveAuthoriser(input.authorisedEmployeeId, input.authorisedBy);

  // C8 - when the goods actually crossed the gate.
  const movementTime = assertMovementTime(input.movementTime, input.type);

  // The vendor named on an unallocated pass is the only record of who
  // delivered, so it is resolved properly rather than taken on trust.
  const namedVendor = input.vendorId
    ? await prisma.vendor.findFirst({
      where: { id: input.vendorId, deletedAt: null },
      select: { id: true, vendorName: true },
    })
    : null;
  if (input.vendorId && !namedVendor) {
    throw ApiError.badRequest('That vendor does not exist', { field: 'vendorId' });
  }

  // Excel: Qty is "(Auto - from the linked document)". A checker may still
  // narrow it - one lorry of a three-lorry delivery - but never widen it.
  // With no document there is nothing to copy and nothing to check against.
  let qty = null;
  if (!unallocated) {
    const expected = D(reference.expectedQty);
    qty = input.qty !== undefined ? D(input.qty) : expected;

    if (!qty.greaterThan(0)) {
      throw ApiError.badRequest(
        reference.kind === 'PURCHASE_ORDER'
          ? `PO ${reference.document.poId} has nothing outstanding - its whole quantity has ` +
            'already been received.'
          : 'The linked document has no quantity to pass through the gate.',
        { field: 'qty', expected: expected.toFixed(4) },
      );
    }
    if (reference.kind === 'PURCHASE_ORDER' && qty.greaterThan(expected)) {
      throw ApiError.badRequest(
        `PO ${reference.document.poId} is still expecting ${expected.toFixed(4)} ` +
          `${reference.uom}. A gate pass cannot admit ${qty.toFixed(4)}.`,
        { field: 'qty', outstanding: expected.toFixed(4) },
      );
    }
  }

  const receivedQty = !unallocated && input.receivedQty !== undefined && input.receivedQty !== null
    ? D(input.receivedQty)
    : null;

  // THE formula. Nothing the client sent contributes to it but the two
  // quantities, and `variationPct` is not a field the client can send.
  const variationPct = calculateVariation(qty, receivedQty);

  const clearing = receivedQty !== null && input.status === 'CLEARED';

  const gatePass = await prisma.$transaction(async (tx) => {
    const gatePassNo = input.gatePassNo?.trim() || (await nextNumber('GATE_PASS', { tx }));
    const clash = await tx.gatePass.findUnique({
      where: { gatePassNo },
      select: { id: true },
    });
    if (clash) {
      throw ApiError.conflict('This gate pass number already exists', { field: 'gatePassNo' });
    }

    return tx.gatePass.create({
      data: {
        gatePassNo,
        gatePassDate: input.gatePassDate ? new Date(input.gatePassDate) : new Date(),
        // C8 - DIFFERENT FROM createdAt, and that difference is the point: a
        // lorry cleared at 21:40 is routinely written up the next morning.
        movementTime,
        type: input.type,
        linkedDocNo: unallocated ? null : input.linkedDocNo.trim(),
        purchaseOrderId: reference?.purchaseOrderId ?? null,
        dyeIssueId: reference?.dyeIssueId ?? null,
        cuttingIssueId: reference?.cuttingIssueId ?? null,
        item: unallocated ? (input.item ?? null) : (input.item ?? reference.item),
        vendorId: input.vendorId ?? reference?.vendorId ?? null,
        partyName:
          input.partyName
          ?? namedVendor?.vendorName
          ?? reference?.partyName
          ?? 'Unnamed party',
        qty,
        receivedQty,
        variationPct,
        uom: unallocated ? (input.uom ?? null) : (input.uom ?? reference.uom),
        purpose: unallocated ? (input.purpose ?? null) : input.purpose,
        // An allocated pass was allocated the moment it was created.
        ...(unallocated ? {} : { allocatedAt: new Date(), allocatedById: actorId }),
        vehicleNo: input.vehicleNo ?? null,
        driverName: input.driverName ?? null,
        authorisedBy: employee?.empName ?? input.authorisedBy ?? null,
        authorisedEmployeeId: employee?.id ?? null,
        status: clearing ? 'CLEARED' : 'PENDING',
        ...(clearing ? { clearedAt: new Date(), clearedById: actorId } : {}),
        remarks: input.remarks ?? null,
        createdById: actorId,
        updatedById: actorId,
      },
      include: LIST_INCLUDE,
    });
  });

  return project(gatePass);
}

/**
 * Edits a gate pass that has not been cleared.
 *
 * The variation is recomputed on every write, whichever field moved. A cleared
 * pass is the record of goods that have already crossed the gate; it is
 * reopened rather than edited behind the checker's back.
 */
export async function update(id, input, actorId) {
  const existing = await prisma.gatePass.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw ApiError.notFound('Gate pass');

  const usage = await downstreamUsage(id);
  const editable = editability(existing, usage);
  if (!editable.canEdit) {
    throw ApiError.conflict(
      existing.status === 'CLEARED'
        ? 'This gate pass has been cleared. Reopen it before changing it.'
        : `This gate pass already has ${usage.grns} GRN(s) against it.`,
      { status: existing.status, usage },
    );
  }

  await validateDropdowns(input);

  const reference =
    input.linkedDocNo !== undefined && input.linkedDocNo !== existing.linkedDocNo
      ? await resolveReference(input.linkedDocNo, { type: input.type ?? existing.type })
      : null;

  const employee =
    input.authorisedEmployeeId !== undefined || input.authorisedBy !== undefined
      ? await resolveAuthoriser(
          input.authorisedEmployeeId !== undefined
            ? input.authorisedEmployeeId
            : existing.authorisedEmployeeId,
          input.authorisedBy !== undefined ? input.authorisedBy : existing.authorisedBy,
        )
      : null;

  const qty = input.qty !== undefined ? D(input.qty) : D(existing.qty);
  const receivedQty =
    input.receivedQty !== undefined
      ? input.receivedQty === null
        ? null
        : D(input.receivedQty)
      : existing.receivedQty === null
        ? null
        : D(existing.receivedQty);

  const gatePass = await prisma.gatePass.update({
    where: { id },
    data: {
      ...(input.gatePassNo !== undefined ? { gatePassNo: input.gatePassNo } : {}),
      ...(input.gatePassDate !== undefined ? { gatePassDate: new Date(input.gatePassDate) } : {}),
      // C8 - correctable, because a clerk mistyping the time of a movement is
      // ordinary. Re-validated on every write: an edit can put a time in the
      // future just as easily as a create can.
      ...(input.movementTime !== undefined
        ? { movementTime: assertMovementTime(input.movementTime, existing.type) }
        : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(reference
        ? {
            linkedDocNo: input.linkedDocNo.trim(),
            purchaseOrderId: reference.purchaseOrderId,
            dyeIssueId: reference.dyeIssueId,
            cuttingIssueId: reference.cuttingIssueId,
          }
        : {}),
      ...(input.item !== undefined ? { item: input.item } : {}),
      ...(input.vendorId !== undefined ? { vendorId: input.vendorId } : {}),
      ...(input.partyName !== undefined ? { partyName: input.partyName } : {}),
      ...(input.uom !== undefined ? { uom: input.uom } : {}),
      ...(input.purpose !== undefined ? { purpose: input.purpose } : {}),
      ...(employee !== null || input.authorisedBy !== undefined
        ? {
            authorisedBy: employee?.empName ?? input.authorisedBy ?? null,
            authorisedEmployeeId: employee?.id ?? null,
          }
        : {}),
      ...(input.vehicleNo !== undefined ? { vehicleNo: input.vehicleNo } : {}),
      ...(input.driverName !== undefined ? { driverName: input.driverName } : {}),
      ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
      qty,
      receivedQty,
      // Recomputed every write, so it can never drift from the two quantities.
      variationPct: calculateVariation(qty, receivedQty),
      updatedById: actorId,
    },
    include: LIST_INCLUDE,
  });

  return project(gatePass);
}

/**
 * Clears the pass: the goods have been counted at the gate.
 *
 * This is the moment the received quantity becomes a fact, so it is required
 * here, and the variation is computed from it. The clearing itself is stamped
 * with who did it rather than typed, exactly like an approval.
 */
/**
 * The second step: attach the document the delivery answers.
 *
 * ---------------------------------------------------------------------------
 *  WHY THIS IS ITS OWN ACT
 *
 *  The gate records who arrived and when. Matching that delivery to a purchase
 *  order is a different job, done by a different person, usually at a desk with
 *  the paperwork in front of them - so it is a named act with its own stamp
 *  rather than an edit that happens to fill four fields.
 *
 *  Everything the document decides - item, quantity, UOM, purpose, the party -
 *  is copied from it HERE, by exactly the same rules `create()` applies when
 *  the document is known up front. There is one place those figures come from.
 *
 *  ALLOCATION IS ONCE.
 *
 *  Re-pointing a pass at a different order after the fact would silently move
 *  goods from one order's receipt history to another's. A pass allocated to the
 *  wrong document is corrected by cancelling it and raising the right one,
 *  which leaves both facts on the record.
 * ---------------------------------------------------------------------------
 */
export async function allocate(id, { linkedDocNo, qty, purpose, remarks }, actor) {
  const gp = await prisma.gatePass.findFirst({ where: { id, deletedAt: null } });
  if (!gp) throw ApiError.notFound('Gate pass');

  if (gp.linkedDocNo) {
    throw ApiError.conflict(
      `Gate pass ${gp.gatePassNo} is already allocated to ${gp.linkedDocNo}. To move it to a `
      + 'different document, cancel this pass and raise the right one.',
      { linkedDocNo: gp.linkedDocNo },
    );
  }
  if (gp.status === 'CLEARED') {
    throw ApiError.badRequest(`Gate pass ${gp.gatePassNo} has already been cleared.`);
  }

  const reference = await resolveReference(linkedDocNo, { type: gp.type });

  // The same quantity rule create() applies: the document decides, and a
  // checker may narrow it to part of the delivery but never widen it.
  const expected = D(reference.expectedQty);
  const allocatedQty = qty !== undefined && qty !== null ? D(qty) : expected;

  if (!allocatedQty.greaterThan(0)) {
    throw ApiError.badRequest(
      reference.kind === 'PURCHASE_ORDER'
        ? `PO ${reference.document.poId} has nothing outstanding - its whole quantity has `
          + 'already been received.'
        : 'The linked document has no quantity to pass through the gate.',
      { field: 'qty', expected: expected.toFixed(4) },
    );
  }
  if (reference.kind === 'PURCHASE_ORDER' && allocatedQty.greaterThan(expected)) {
    throw ApiError.badRequest(
      `PO ${reference.document.poId} is still expecting ${expected.toFixed(4)} `
      + `${reference.uom}. A gate pass cannot admit ${allocatedQty.toFixed(4)}.`,
      { field: 'qty', outstanding: expected.toFixed(4) },
    );
  }

  const chosenPurpose = purpose ?? gp.purpose;
  if (!chosenPurpose) {
    throw ApiError.badRequest('Say what the goods are here for', { field: 'purpose' });
  }

  /*
   * Claimed by naming the state it must still be in, so two people allocating
   * the same delivery at once cannot both win - the same guard the approval
   * engine uses, for the same reason.
   */
  const claimed = await prisma.gatePass.updateMany({
    where: { id, linkedDocNo: null, deletedAt: null },
    data: {
      linkedDocNo: linkedDocNo.trim(),
      purchaseOrderId: reference.purchaseOrderId,
      dyeIssueId: reference.dyeIssueId,
      cuttingIssueId: reference.cuttingIssueId,
      item: gp.item ?? reference.item,
      // The vendor the gate named stands: it is what was actually observed.
      // The document's party fills the gap only where the gate left one.
      vendorId: gp.vendorId ?? reference.vendorId,
      partyName: gp.partyName && gp.partyName !== 'Unnamed party'
        ? gp.partyName
        : (reference.partyName ?? gp.partyName),
      qty: allocatedQty,
      uom: gp.uom ?? reference.uom,
      purpose: chosenPurpose,
      allocatedAt: new Date(),
      allocatedById: actor.userId ?? null,
      allocatedByName: actor.fullName ?? null,
      ...(remarks !== undefined ? { remarks } : {}),
      updatedById: actor.userId ?? null,
    },
  });

  if (claimed.count === 0) {
    throw ApiError.conflict(
      `Gate pass ${gp.gatePassNo} was allocated by somebody else a moment ago. Reload it and `
      + 'check which document it went to before acting again.',
      { code: ERROR_CODES.CONCURRENT_DECISION },
    );
  }

  const updated = await prisma.gatePass.findUnique({ where: { id }, include: LIST_INCLUDE });
  return project(updated);
}

export async function clear(id, { receivedQty, remarks }, actor) {
  const gp = await prisma.gatePass.findFirst({ where: { id, deletedAt: null } });
  if (!gp) throw ApiError.notFound('Gate pass');

  /*
   * A pass is allocated before it is cleared.
   *
   * Clearing records what was counted, and a GRN is raised from that count
   * against the purchase order the pass names. With no document there is
   * nothing to receive the goods against, and the receipt would have nowhere
   * to go. A CHECK constraint refuses it too; this refuses it in words.
   */
  if (!gp.linkedDocNo) {
    throw ApiError.badRequest(
      `Gate pass ${gp.gatePassNo} has not been allocated to a document yet. Match the delivery `
      + 'to its purchase order, job work or cutting challan first - the receipt is booked '
      + 'against that document.',
      { field: 'linkedDocNo' },
    );
  }
  // Checked before the table, because assertStatusTransition treats a move to
  // the state you are already in as a no-op - which is right for a status that
  // is being set, and wrong for an act that stamps who did it and when.
  // Clearing a pass twice would overwrite the first checker's name.
  if (gp.status === 'CLEARED') {
    throw ApiError.badRequest(`Gate pass ${gp.gatePassNo} has already been cleared.`);
  }
  engine.assertStatusTransition(gp.status, 'CLEARED', {
    label: gp.gatePassNo,
    table: engine.GATE_PASS_TRANSITIONS,
  });

  const received = D(receivedQty);
  if (received.isNegative()) {
    throw ApiError.badRequest('Received quantity cannot be negative', { field: 'receivedQty' });
  }

  const variationPct = calculateVariation(gp.qty, received);

  const updated = await prisma.gatePass.update({
    where: { id },
    data: {
      receivedQty: received,
      variationPct,
      status: 'CLEARED',
      clearedAt: new Date(),
      clearedById: actor.userId,
      clearedByName: actor.fullName,
      remarks: remarks ?? gp.remarks,
      updatedById: actor.userId,
    },
    include: LIST_INCLUDE,
  });

  return project(updated);
}

/**
 * Reopens a cleared pass.
 *
 * Refused once a GRN has been raised on it: the GRN recorded goods into stock
 * on the strength of this pass, and reopening it underneath would leave the
 * receipt standing on a pass that says the goods never arrived.
 */
export async function reopen(id, { reason }, actor) {
  const gp = await prisma.gatePass.findFirst({ where: { id, deletedAt: null } });
  if (!gp) throw ApiError.notFound('Gate pass');
  // Same reasoning as clear(): a move to the state you are already in is a
  // no-op to the table, but reopening a pass that was never cleared is a
  // mistake worth naming.
  if (gp.status !== 'CLEARED') {
    throw ApiError.badRequest(`Gate pass ${gp.gatePassNo} has not been cleared.`);
  }
  engine.assertStatusTransition(gp.status, 'PENDING', {
    label: gp.gatePassNo,
    table: engine.GATE_PASS_TRANSITIONS,
  });

  const usage = await downstreamUsage(id);
  if (usage.grns > 0) {
    throw ApiError.conflict(
      `${usage.grns} GRN(s) were received on this gate pass; it cannot be reopened.`,
      { usage },
    );
  }

  const updated = await prisma.gatePass.update({
    where: { id },
    data: {
      status: 'PENDING',
      clearedAt: null,
      clearedById: null,
      clearedByName: null,
      remarks: reason ?? gp.remarks,
      updatedById: actor.userId,
    },
    include: LIST_INCLUDE,
  });

  return project(updated);
}

/** Soft delete. Refused once a GRN exists or the pass has been cleared. */
export async function remove(id, actorId) {
  const gp = await prisma.gatePass.findFirst({ where: { id, deletedAt: null } });
  if (!gp) throw ApiError.notFound('Gate pass');

  const usage = await downstreamUsage(id);
  if (usage.grns > 0) {
    throw ApiError.conflict(
      `This gate pass has ${usage.grns} GRN(s) against it and cannot be deleted.`,
      { usage },
    );
  }
  if (gp.status === 'CLEARED') {
    throw ApiError.conflict(
      'A cleared gate pass records goods that crossed the gate and cannot be deleted. ' +
        'Reopen it first if it was raised in error.',
    );
  }

  await prisma.gatePass.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: actorId },
  });
  return { deleted: true };
}

// ---------------------------------------------------------------------------
//  Previews and printing
// ---------------------------------------------------------------------------

/**
 * What the gate pass form needs before anything is saved: the resolved
 * reference, the quantity that will be defaulted in, the variation for a
 * received quantity the checker is still typing, and the number the pass will
 * be given.
 */
export async function preview({ linkedDocNo, type, qty, receivedQty }) {
  const reference = await resolveReference(linkedDocNo, { type });
  const expected = D(qty ?? reference.expectedQty);
  const variation = calculateVariation(expected, receivedQty ?? null);

  return {
    reference: {
      kind: reference.kind,
      no: linkedDocNo.trim(),
      partyName: reference.partyName,
      item: reference.item,
      uom: reference.uom,
      documentQty: reference.documentQty,
      expectedQty: reference.expectedQty,
      orderNo: reference.orderNo,
      naturalType: reference.naturalType,
    },
    qty: expected.toFixed(4),
    receivedQty: receivedQty === undefined || receivedQty === null ? null : D(receivedQty).toFixed(4),
    variationPct: variation.toFixed(6),
    variationPctDisplay: variation.mul(100).toDecimalPlaces(2).toFixed(2),
    variationDirection:
      receivedQty === undefined || receivedQty === null
        ? null
        : variation.isZero()
          ? 'EXACT'
          : variation.isPositive()
            ? 'SHORT'
            : 'EXCESS',
    formula: 'Variation % = (Qty - Received Qty) / Qty',
    nextGatePassNo: await peekNumber('GATE_PASS'),
  };
}

/**
 * The printable gate pass - the slip the security desk keeps.
 *
 * Assembled here for the same reason the PO print is: the printed document and
 * the stored document must be the same document. Nothing below is recalculated
 * in the browser.
 */
export async function printView(id) {
  const gp = await prisma.gatePass.findFirst({
    where: { id, deletedAt: null },
    include: INCLUDE,
  });
  if (!gp) throw ApiError.notFound('Gate pass');

  const reference = referenceOf(gp);
  const variation = D(gp.variationPct);

  return {
    documentTitle: gp.type === 'INWARD' ? 'INWARD GATE PASS' : 'OUTWARD GATE PASS',
    gatePassNo: gp.gatePassNo,
    gatePassDate: gp.gatePassDate,
    type: gp.type,
    status: gp.status,
    party: {
      name: gp.partyName,
      vendorCode: gp.vendor?.vendorCode ?? null,
      address: gp.vendor?.address ?? null,
      gstNo: gp.vendor?.gstNo ?? null,
      contactPerson: gp.vendor?.contactPerson ?? null,
      phone: gp.vendor?.phone ?? null,
    },
    reference: {
      linkedDocNo: gp.linkedDocNo,
      kind: reference.kind,
      chain: reference.chain,
      party: reference.party ?? null,
    },
    line: {
      item: gp.item,
      uom: gp.uom,
      qty: D(gp.qty).toFixed(4),
      receivedQty: gp.receivedQty === null ? null : D(gp.receivedQty).toFixed(4),
      variationPct: variation.toFixed(6),
      variationPctDisplay: variation.mul(100).toDecimalPlaces(2).toFixed(2),
      purpose: gp.purpose,
    },
    authorisation: {
      authorisedBy: gp.authorisedBy,
      employee: gp.authorisedEmployee
        ? {
            empId: gp.authorisedEmployee.empId,
            empName: gp.authorisedEmployee.empName,
            designation: gp.authorisedEmployee.designation,
            department: gp.authorisedEmployee.department,
          }
        : null,
      clearedByName: gp.clearedByName,
      clearedAt: gp.clearedAt,
    },
    remarks: gp.remarks,
    /** The three signatures the paper slip carries. */
    signatures: ['Prepared By', 'Authorised By', 'Security'],
    printedAt: new Date().toISOString(),
  };
}

/** Cleared inward gate passes, for the GRN screen to pick a receipt from. */
export async function options({ purchaseOrderId, type, clearedOnly, withoutGrn } = {}) {
  const rows = await prisma.gatePass.findMany({
    where: {
      deletedAt: null,
      ...(purchaseOrderId ? { purchaseOrderId } : {}),
      ...(type ? { type } : {}),
      ...(clearedOnly ? { status: 'CLEARED' } : {}),
      ...(withoutGrn ? { grns: { none: { deletedAt: null } } } : {}),
    },
    orderBy: { gatePassDate: 'desc' },
    take: OPTIONS_LIMIT,
    select: {
      id: true,
      gatePassNo: true,
      gatePassDate: true,
      type: true,
      linkedDocNo: true,
      item: true,
      partyName: true,
      qty: true,
      receivedQty: true,
      variationPct: true,
      uom: true,
      purpose: true,
      status: true,
      purchaseOrder: { select: { id: true, poId: true } },
    },
  });
  return rows;
}

// ===========================================================================
//  C8 - MOVEMENT TIME
// ===========================================================================

/**
 * The moment the goods physically crossed the gate.
 *
 * ---------------------------------------------------------------------------
 *  WHY THIS IS NOT createdAt
 *
 *  A gate pass is written up when the clerk gets to it, which is routinely the
 *  next morning for anything that moved after hours. Stage-timing built on
 *  record-creation time would report that the lorry waited overnight at the
 *  gate, which is both wrong and the kind of wrong that gets argued about.
 *
 *  Required on BOTH directions. C8 says "for inward and outward", and it is
 *  worth being explicit that neither is exempt: an outward pass without a
 *  movement time cannot evidence when company property left the premises,
 *  which is the one thing an outward gate pass is for.
 *
 *  A FUTURE TIME IS REFUSED.
 *
 *  A gate pass records goods that have ALREADY crossed. Recording a future one
 *  is either a typo or an attempt to pre-date a movement, and the two are
 *  indistinguishable from here - so both are refused.
 *
 *  Checked here for the message and by the
 *  `gate_passes_movement_time_not_future` trigger for the guarantee. A CHECK
 *  constraint cannot do it: `now()` is not immutable and PostgreSQL will not
 *  accept it in one.
 * ---------------------------------------------------------------------------
 *
 * @param {string|Date} value
 * @param {'INWARD'|'OUTWARD'} type
 * @returns {Date}
 */
export function assertMovementTime(value, type) {
  if (value === undefined || value === null || value === '') {
    throw ApiError.badRequest(
      `An ${String(type ?? '').toLowerCase() || ''} gate pass must record when the goods ` +
        'actually crossed the gate. That is not the same as when this record was created, and ' +
        'the stage-timing report depends on the difference.',
      { field: 'movementTime', type: type ?? null },
    );
  }

  const at = new Date(value);
  if (Number.isNaN(at.getTime())) {
    throw ApiError.badRequest('Movement time is not a valid date and time', {
      field: 'movementTime',
      received: value,
    });
  }

  if (at.getTime() > Date.now()) {
    throw ApiError.badRequest(
      `Movement time ${at.toISOString()} is in the future. A gate pass records goods that have ` +
        'already crossed the gate.',
      { field: 'movementTime', movementTime: at.toISOString(), now: new Date().toISOString() },
    );
  }

  return at;
}
