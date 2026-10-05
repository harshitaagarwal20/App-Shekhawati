/**
 * Fabric Issue. Sheet: "Fabric Issue" - Fabric Issue for Cutting Format
 * (Role Acess - Cutting Dept (Supervisor); the Phase 1 brief also gives it to
 * the Store Manager).
 *
 * ===========================================================================
 *  THIS IS A SHOP-FLOOR TRANSACTION
 * ===========================================================================
 *
 * It is filled in standing next to a rack, on a phone, by somebody holding a
 * roll. Three consequences run through this file:
 *
 *   - `rollOptions()` returns everything the screen needs to show a roll -
 *     number, fabric, colour, balance, stage, location - in ONE call, so the
 *     picker works on a slow connection and the storeman is never asked to
 *     type an attribute the roll already knows.
 *
 *   - `preview()` answers "can I issue this much?" before the issue is saved,
 *     against the same code the save runs. On a phone, finding out after the
 *     fact is finding out too late.
 *
 *   - every refusal names the roll, the quantity and the shortfall, because a
 *     message that just says "insufficient stock" sends somebody back to a
 *     desktop to find out why.
 *
 * ---------------------------------------------------------------------------
 *  REQUESTED QUANTITY <= AVAILABLE STOCK, CHECKED TWICE, SERVER-SIDE
 *
 *  Availability is checked at two levels, because they can disagree and both
 *  matter:
 *
 *    1. THE ROLL.   `balanceQty` is what is physically left on that roll. You
 *                   cannot issue 300 metres off a roll with 250 on it, however
 *                   much of that fabric the store holds in total.
 *    2. THE LEDGER. `availableQty()` sums the movements for the item at that
 *                   location. This is the company-level check the brief asks
 *                   for, and it is computed from the ledger rather than read
 *                   off the balance cache.
 *
 *  Both run INSIDE the posting transaction, against rows the transaction has
 *  locked, so two storemen issuing the same roll at the same moment cannot both
 *  succeed.
 *
 *  AFTER POSTING, A STOCK LEDGER OUT EXISTS. Always.
 *
 *  The issue, the ledger OUT, the roll balance, the roll stage and the balance
 *  cache are one transaction. `postedAt` is set inside it, so it can only ever
 *  be true of an issue whose stock movement committed with it.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError, ERROR_CODES } from '../utils/ApiError.js';
import { acceptedMixReason, assessShadeMix, MIN_MIX_REASON } from '../domain/shade.js';
import { OPTIONS_LIMIT, searchFilter } from '../utils/http.js';
import { assertValueInList } from './masterList.service.js';
import { nextNumber, peekNumber } from './documentNumber.service.js';
import {
  DEFAULT_LOCATION,
  availableQty,
  isAvailableForIssue,
  postMovement,
} from './inventory.service.js';
import * as engine from './approvalEngine.js';
// C5 - the cutting challan line every new issue has to quote.
import { assertLineCanTake, recomputeLineFulfilment } from './cuttingChallan.service.js';

export const SORTABLE = [
  'issueNo',
  'issueDate',
  'purpose',
  'fabricQtyIssued',
  'status',
  'createdAt',
];

const SEARCH = ['issueNo', 'fabricName', 'colorCode', 'issuedByName', 'remarks'];

const D = (v) => new Prisma.Decimal(v ?? 0);
const ZERO = D(0);

/**
 * Where a roll ends up, by what it was issued for.
 *
 * The purpose column is not decoration: it is what routes the roll onward, and
 * the stage is how every later screen knows where the fabric physically is.
 */
const STAGE_FOR_PURPOSE = {
  DYEING: 'ISSUED_FOR_DYEING',
  PRINTING: 'ISSUED_FOR_PRINTING',
  CUTTING: 'ISSUED_TO_CUTTING',
  STITCHING: 'ISSUED_TO_CUTTING',
  SAMPLING: 'CONSUMED',
  RETURN: 'RAW',
  OTHER: 'RAW',
};

/**
 * Where the fabric physically sits after being issued for that purpose.
 *
 * C3 / C6: these are no longer only labels on a roll. Every one of them except
 * RETURN is an IN-PROCESS STOCK LOCATION, and issuing to one is a TRANSFER -
 * out of the store, in at the destination - rather than the fabric leaving the
 * company's books. See the note on `inventory.service.js` LOCATION.
 */
const LOCATION_FOR_PURPOSE = {
  DYEING: 'AT DYEING VENDOR',
  PRINTING: 'AT PRINTING VENDOR',
  CUTTING: 'CUTTING FLOOR',
  STITCHING: 'CUTTING FLOOR',
  // A return comes back to the store it was issued from, not to wherever the
  // roll was last seen - which for a cutting return is the cutting floor.
  RETURN: DEFAULT_LOCATION,
};

/**
 * A RETURN is this document run backwards.
 *
 * ---------------------------------------------------------------------------
 *  WHY THIS PREDICATE EXISTS
 *
 *  `RETURN` has always been in the purpose list, the screen has always offered
 *  it as "Return - back to the store", and `STAGE_FOR_PURPOSE` has always sent
 *  the roll back to RAW. But the posting treated it like every other purpose:
 *  it checked availability, wrote a ledger OUT and SUBTRACTED from the roll.
 *
 *  So returning 50 m of leftover cloth removed another 50 m from stock instead
 *  of putting it back, and - because the availability check ran first - a
 *  return off a roll that had been fully issued was refused outright. That is
 *  exactly the case the feature is for: the cutting floor sending back what it
 *  did not use, which is the plan's "remaining fabric is rolled back to the
 *  inventory".
 *
 *  It also broke the documented way to correct a mis-keyed issue. See the note
 *  on `update()`: the ledger is append-only, so a wrong issue is meant to be
 *  cancelled by a return.
 *
 *  Everything a return reverses is derived from this one predicate rather than
 *  branched on `purpose` in four places, so the direction, the availability
 *  rule and the roll arithmetic cannot disagree with each other.
 * ---------------------------------------------------------------------------
 */
const isReturn = (purpose) => purpose === 'RETURN';

const INCLUDE = {
  roll: {
    select: {
      id: true,
      rollNo: true,
      fabricName: true,
      colorCode: true,
      content: true,
      count: true,
      construction: true,
      width: true,
      gsm: true,
      uom: true,
      receivedQty: true,
      balanceQty: true,
      rate: true,
      stage: true,
      location: true,
      isHeld: true,
      grn: { select: { id: true, grnNo: true } },
      vendor: { select: { id: true, vendorName: true } },
      inventoryItem: { select: { id: true, itemCode: true, description: true } },
    },
  },
  order: {
    select: {
      id: true,
      orderNo: true,
      orderQty: true,
      effectiveQty: true,
      status: true,
      buyer: { select: { id: true, buyerName: true } },
    },
  },
  style: { select: { id: true, styleNo: true, styleDescription: true } },
  vendor: { select: { id: true, vendorCode: true, vendorName: true, category: true } },
  issuedByEmployee: {
    select: { id: true, empId: true, empName: true, department: true, designation: true },
  },
  inventoryItem: { select: { id: true, itemCode: true, description: true, uom: true } },
};

const LIST_INCLUDE = {
  roll: { select: { id: true, rollNo: true, fabricName: true, colorCode: true, stage: true } },
  order: { select: { id: true, orderNo: true } },
  style: { select: { id: true, styleNo: true } },
  vendor: { select: { id: true, vendorName: true } },
};

// ===========================================================================
//  VALIDATION HELPERS
// ===========================================================================

async function validateDropdowns(data) {
  if (data.colorCode !== undefined) {
    await assertValueInList('ColorCode', data.colorCode, { field: 'colorCode' });
  }
  if (data.uom !== undefined) await assertValueInList('UOM', data.uom, { field: 'uom' });
  if (data.location !== undefined) {
    await assertValueInList('StockLocation', data.location, { field: 'location' });
  }
}

/**
 * The roll being issued.
 *
 * A held roll is refused: `isHeld` is set by an out-of-tolerance dyeing return
 * or a scrutiny reject, and the whole point of holding it is that it must not
 * reach the floor until somebody decides what to do with it.
 */
async function resolveRoll(rollId, tx = prisma) {
  const roll = await tx.fabricRoll.findFirst({
    where: { id: rollId, deletedAt: null },
    include: {
      inventoryItem: true,
      vendor: { select: { id: true, vendorName: true } },
      grn: { select: { id: true, grnNo: true } },
    },
  });
  if (!roll) throw ApiError.badRequest('Fabric roll does not exist', { field: 'rollId' });

  if (roll.isHeld) {
    throw ApiError.conflict(
      `Roll ${roll.rollNo} is on hold${roll.stage === 'SCRUTINY_HOLD' ? ' pending scrutiny' : ''} ` +
        'and cannot be issued until the hold is lifted.',
      { field: 'rollId', stage: roll.stage },
    );
  }
  if (roll.stage === 'REJECTED') {
    throw ApiError.conflict(`Roll ${roll.rollNo} has been rejected and cannot be issued.`, {
      field: 'rollId',
    });
  }
  if (!roll.inventoryItemId) {
    throw ApiError.conflict(
      `Roll ${roll.rollNo} is not linked to a stock item, so issuing it could not be recorded in ` +
        'the stock ledger. Check how it was received.',
      { field: 'rollId' },
    );
  }
  return roll;
}

/** The order the fabric is being consumed for. */
async function resolveOrder(orderId) {
  const order = await prisma.buyerOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    select: { id: true, orderNo: true, status: true, styleId: true },
  });
  if (!order) throw ApiError.badRequest('Order does not exist', { field: 'orderId' });
  if (order.status === 'CANCELLED') {
    throw ApiError.badRequest(
      `Order ${order.orderNo} is cancelled - fabric cannot be issued against it`,
      { field: 'orderId' },
    );
  }
  return order;
}

/** The person issuing. The sheet prints a name; here it resolves to a record. */
async function resolveIssuer(issuedByEmployeeId, issuedByName) {
  if (issuedByEmployeeId) {
    const employee = await prisma.employee.findFirst({
      where: { id: issuedByEmployeeId, deletedAt: null },
    });
    if (!employee) {
      throw ApiError.badRequest('Employee does not exist', { field: 'issuedByEmployeeId' });
    }
    if (employee.status !== 'ACTIVE') {
      throw ApiError.badRequest(`${employee.empName} is inactive`, {
        field: 'issuedByEmployeeId',
      });
    }
    return employee;
  }
  if (!issuedByName) {
    throw ApiError.badRequest('Name the person issuing the fabric', {
      field: 'issuedByEmployeeId',
    });
  }
  // A name with no matching employee record is accepted - the cutting floor
  // has casual staff - but it is resolved where it can be.
  return prisma.employee.findFirst({
    where: { empName: issuedByName, deletedAt: null, status: 'ACTIVE' },
  });
}

/** The job worker, when the fabric is going out to one. */
async function resolveJobWorker(vendorId, purpose) {
  if (!vendorId) {
    if (purpose === 'DYEING' || purpose === 'PRINTING') {
      throw ApiError.badRequest(
        `Fabric issued for ${purpose.toLowerCase()} is going to a job worker. Name the vendor.`,
        { field: 'vendorId' },
      );
    }
    return null;
  }
  const vendor = await prisma.vendor.findFirst({ where: { id: vendorId, deletedAt: null } });
  if (!vendor) throw ApiError.badRequest('Vendor does not exist', { field: 'vendorId' });
  if (vendor.status !== 'ACTIVE') {
    throw ApiError.badRequest(`Vendor "${vendor.vendorName}" is inactive`, { field: 'vendorId' });
  }
  return vendor;
}

/** Counts what has been raised against an issue. */
async function downstreamUsage(fabricIssueId) {
  const [jobWorks, cuttingIssues, movements] = await Promise.all([
    prisma.dyeIssue.count({ where: { fabricIssueId, deletedAt: null } }),
    prisma.cuttingIssue.count({ where: { fabricIssueId, deletedAt: null } }),
    prisma.stockLedger.count({
      where: { documentType: 'FABRIC_ISSUE', documentId: fabricIssueId },
    }),
  ]);
  return { jobWorks, cuttingIssues, movements, total: jobWorks + cuttingIssues };
}

/**
 * A posted issue is a stock movement, and stock movements are not edited.
 * Only the descriptive fields stay open.
 */
function editability(issue, usage) {
  const posted = Boolean(issue.postedAt);
  return {
    canEditDetails: issue.status !== 'CANCELLED',
    canEditQuantities: !posted && usage.movements === 0,
    canDelete: !posted && usage.total === 0,
    posted,
    lockedBy: [
      usage.movements > 0 ? `${usage.movements} stock ledger entry` : null,
      usage.jobWorks > 0 ? `${usage.jobWorks} job work issue(s)` : null,
      usage.cuttingIssues > 0 ? `${usage.cuttingIssues} cutting challan(s)` : null,
    ].filter(Boolean),
  };
}

// ===========================================================================
//  AVAILABILITY - the check the brief asks for, in one place
// ===========================================================================

/**
 * Can this quantity come off this roll, right now?
 *
 * Answers at both levels - the roll and the ledger - and reports each, so a
 * refusal can say WHICH one failed. The preview endpoint and the posting
 * transaction both call this; there is no second copy of the rule.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
/**
 * C3 - the purposes that send fabric OUT OF THE COMPANY to a job worker.
 *
 * These are the ones that need an approved Job Work order behind them.
 * CUTTING does not: the cutting floor is inside the building, and its
 * authorisation is the Cutting Challan (C5).
 */
const JOB_WORK_PURPOSES = { DYEING: 'DYEING', PRINTING: 'PRINTING' };

/** Whether this purpose sends fabric to a job worker. Pure. */
export function requiresJobWorkOrder(purpose) {
  return Boolean(JOB_WORK_PURPOSES[purpose]);
}

/**
 * C3 - REFUSES TO LET FABRIC LEAVE FOR A JOB WORKER WITHOUT AN APPROVED ORDER.
 *
 * ---------------------------------------------------------------------------
 *  "Fabric cannot simply be issued to a job worker through a bare stock
 *   movement. A separate Job Work PO/order must exist for the vendor."
 *
 *  Before C3 the Job Work order was raised AFTER the fabric had gone - it
 *  pointed back at the fabric issue - so the vendor had the cloth before
 *  anybody had authorised sending it. The order now comes first, is approved
 *  first, and this is the gate.
 *
 *  It looks for an APPROVED job work order that names the same roll, the same
 *  process and the same vendor, and still has quantity left to send. Matching
 *  on the roll rather than on an id the caller passes is deliberate: it means
 *  a store keeper cannot satisfy the check by quoting some other roll's
 *  authorisation.
 *
 *  ONE PO, SEVERAL CHALLANS. A PO for 10,000 may go out as two challans of
 *  5,000. Each challan draws on the order's balance (qty - issuedQty); the
 *  first one moves the order to POSTED, and later ones keep drawing on it
 *  until the balance is spent. Over-sending is refused here and, failing
 *  that, by `dye_issues_issued_within_ordered`.
 * ---------------------------------------------------------------------------
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export async function assertJobWorkAuthorised(tx, { rollId, purpose, vendorId, qty }) {
  const db = tx ?? prisma;
  const process = JOB_WORK_PURPOSES[purpose];

  const candidates = await db.dyeIssue.findMany({
    where: {
      // C16: a job covers a SET of rolls. Matching on the header's lead roll
      // found no authority for the second roll of a multi-roll lot, so a
      // perfectly authorised challan was refused.
      rolls: { some: { rollId, deletedAt: null } },
      process,
      deletedAt: null,
      // APPROVED, or POSTED by an earlier challan and not yet fully sent. A
      // DRAFT one has not been authorised at all. A POSTED one with no stock
      // leg predates C3 and was never drawn on by challans.
      OR: [{ workflowState: 'APPROVED' }, { workflowState: 'POSTED', stockPostedAt: { not: null } }],
      status: { notIn: ['COMPLETED', 'CANCELLED'] },
      ...(vendorId ? { vendorId } : {}),
    },
    include: {
      vendor: { select: { id: true, vendorName: true } },
      // Only the line for THIS roll: it is the one that authorises the issue.
      rolls: {
        where: { rollId, deletedAt: null },
        include: { roll: { select: { id: true, rollNo: true } } },
      },
    },
    orderBy: { issueDate: 'asc' },
  });

  /*
   * C16 - THE BALANCE IS THE ROLL'S, NOT THE JOB'S.
   *
   * A job for 100m of roll A and 200m of roll B is a 300m job. Measuring an
   * issue of roll A against the header would have let 250m of A go out and
   * called it authorised, because the lot as a whole still had room. Every
   * figure below therefore comes off the line for the roll being issued.
   */
  const lineOf = (c) => c.rolls?.[0] ?? null;
  const balance = (c) => {
    const line = lineOf(c);
    return line ? D(line.qty).minus(D(line.issuedQty)) : ZERO;
  };

  const open = candidates.filter((c) => balance(c).greaterThan(ZERO));

  if (!open.length) {
    const roll = await db.fabricRoll.findUnique({
      where: { id: rollId },
      select: { rollNo: true },
    });

    throw new ApiError(
      409,
      `No approved job work order exists for roll ${roll?.rollNo ?? rollId} and ` +
        `${String(process).toLowerCase()}` +
        '. Fabric cannot be sent to a job worker on a bare issue - raise the job work order, ' +
        'have it approved, and then issue against it.',
      {
        code: ERROR_CODES.VERIFICATION_FAILED,
        details: {
          field: 'purpose',
          rollId,
          process,
          vendorId: vendorId ?? null,
          required: 'An APPROVED job work order naming this roll, process and vendor.',
        },
      },
    );
  }

  // The order has to cover what is being sent. Sending more than the order
  // has left is the same failure as over-ordering against a requirement.
  // An order already part-sent is used up first, so a PO is finished off
  // before the next one is started.
  const wanted = D(qty);
  const covering =
    open.find((c) => c.workflowState === 'POSTED' && balance(c).greaterThanOrEqualTo(wanted)) ??
    open.find((c) => balance(c).greaterThanOrEqualTo(wanted));

  if (!covering) {
    const biggest = open.reduce((a, c) => (balance(c).greaterThan(balance(a)) ? c : a));
    const line = lineOf(biggest);
    const rollNo = line?.roll?.rollNo ?? rollId;
    throw new ApiError(
      409,
      `Job work order ${biggest.dyeIssueNo} covers ${D(line?.qty ?? 0).toFixed(4)} of roll ` +
        `${rollNo}, of which ${D(line?.issuedQty ?? 0).toFixed(4)} has already gone on earlier ` +
        `challans - ${balance(biggest).toFixed(4)} is left and ${wanted.toFixed(4)} is being ` +
        'issued. Amend the order or issue less.',
      {
        code: ERROR_CODES.VERIFICATION_FAILED,
        details: {
          field: 'fabricQtyIssued',
          jobWorkNo: biggest.dyeIssueNo,
          rollNo,
          authorisedQty: D(line?.qty ?? 0).toFixed(4),
          alreadyIssuedQty: D(line?.issuedQty ?? 0).toFixed(4),
          balanceQty: balance(biggest).toFixed(4),
          requestedQty: wanted.toFixed(4),
        },
      },
    );
  }

  return covering;
}

export async function checkAvailability(tx, { roll, qty, location }) {
  const requested = D(qty);
  const at = location ?? roll.location ?? DEFAULT_LOCATION;

  const rollBalance = D(roll.balanceQty);
  const ledgerAvailable = roll.inventoryItemId
    ? await availableQty(tx, roll.inventoryItemId, at)
    : ZERO;

  const rollShort = requested.greaterThan(rollBalance)
    ? requested.minus(rollBalance)
    : ZERO;
  const ledgerShort = requested.greaterThan(ledgerAvailable)
    ? requested.minus(ledgerAvailable)
    : ZERO;

  return {
    rollNo: roll.rollNo,
    location: at,
    uom: roll.uom,
    requested: requested.toFixed(4),
    rollBalance: rollBalance.toFixed(4),
    ledgerAvailable: ledgerAvailable.toFixed(4),
    rollShort: rollShort.toFixed(4),
    ledgerShort: ledgerShort.toFixed(4),
    withinRoll: rollShort.isZero(),
    withinStock: ledgerShort.isZero(),
    permitted: rollShort.isZero() && ledgerShort.isZero(),
    /** What could be issued off this roll right now. */
    maxIssuable: (rollBalance.lessThan(ledgerAvailable) ? rollBalance : ledgerAvailable).toFixed(4),
  };
}

/** Turns a failed availability check into the refusal the storeman sees. */
function assertAvailable(check) {
  if (check.permitted) return;

  if (!check.withinRoll) {
    throw ApiError.conflict(
      `Roll ${check.rollNo} has ${check.rollBalance} ${check.uom} left. ` +
        `${check.requested} cannot be issued off it - short by ${check.rollShort}.`,
      { field: 'fabricQtyIssued', availability: check },
    );
  }
  throw ApiError.conflict(
    `Only ${check.ledgerAvailable} ${check.uom} of this fabric is in stock at ${check.location}. ` +
      `${check.requested} cannot be issued - short by ${check.ledgerShort}.`,
    { field: 'fabricQtyIssued', availability: check },
  );
}

// ===========================================================================
//  PROJECTION
// ===========================================================================

function project(issue) {
  if (!issue) return issue;
  return {
    ...issue,
    posted: Boolean(issue.postedAt),
    /** Where the roll went, restated so a list can show it without a join. */
    destination:
      issue.vendor?.vendorName ??
      LOCATION_FOR_PURPOSE[issue.purpose] ??
      issue.location ??
      DEFAULT_LOCATION,
  };
}

// ===========================================================================
//  QUERIES
// ===========================================================================

export async function list(query) {
  const {
    page, pageSize, skip, take, orderBy, search, includeDeleted,
    purpose, status, orderId, styleId, rollId, vendorId, employeeId, dateFrom, dateTo,
  } = query;

  const where = {
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(purpose ? { purpose } : {}),
    ...(status ? { status } : {}),
    ...(orderId ? { orderId } : {}),
    ...(styleId ? { styleId } : {}),
    ...(rollId ? { rollId } : {}),
    ...(vendorId ? { vendorId } : {}),
    ...(employeeId ? { issuedByEmployeeId: employeeId } : {}),
    ...(dateFrom || dateTo
      ? {
          issueDate: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(dateTo) } : {}),
          },
        }
      : {}),
    ...searchFilter(search, SEARCH),
  };

  const [rows, total, totals] = await Promise.all([
    prisma.fabricIssue.findMany({ where, orderBy, skip, take, include: LIST_INCLUDE }),
    prisma.fabricIssue.count({ where }),
    prisma.fabricIssue.aggregate({ where, _sum: { fabricQtyIssued: true } }),
  ]);

  return {
    rows: rows.map(project),
    total,
    page,
    pageSize,
    totals: { fabricQtyIssued: D(totals._sum.fabricQtyIssued ?? 0).toFixed(4) },
  };
}

export async function getById(id) {
  const issue = await prisma.fabricIssue.findFirst({
    where: { id, deletedAt: null },
    include: INCLUDE,
  });
  if (!issue) throw ApiError.notFound('Fabric issue');

  const [usage, movements, jobWorks, cuttingIssues] = await Promise.all([
    downstreamUsage(id),
    prisma.stockLedger.findMany({
      where: { documentType: 'FABRIC_ISSUE', documentId: id },
      orderBy: { createdAt: 'asc' },
      include: { item: { select: { id: true, itemCode: true, description: true } } },
    }),
    prisma.dyeIssue.findMany({
      where: { deletedAt: null, OR: [{ fabricIssueId: id }, { challans: { some: { id } } }] },
      orderBy: { issueDate: 'asc' },
      select: {
        id: true,
        dyeIssueNo: true,
        issueDate: true,
        process: true,
        qty: true,
        issuedQty: true,
        receivedQty: true,
        shrinkagePct: true,
        status: true,
        vendor: { select: { id: true, vendorName: true } },
      },
    }),
    prisma.cuttingIssue.findMany({
      where: { fabricIssueId: id, deletedAt: null },
      orderBy: { issueDate: 'asc' },
      select: {
        id: true,
        challanNo: true,
        issueDate: true,
        firmName: true,
        cuttingPcsIssued: true,
        status: true,
      },
    }),
  ]);

  return {
    ...project(issue),
    movements,
    jobWorks,
    cuttingIssues,
    usage,
    editable: editability(issue, usage),
  };
}

/** What the printed slip is called, by where the fabric is going. */
const CHALLAN_TITLE = {
  DYEING: 'DYEING CHALLAN',
  PRINTING: 'PRINTING CHALLAN',
};

/**
 * The printable challan - the paper that travels with the fabric to the job
 * worker.
 *
 * One job work PO may go out on several challans (10,000 as 5,000 + 5,000),
 * so the challan states where it sits in that PO: what the PO is for, what
 * went on earlier challans, what goes on this one, and what is still to go.
 * "Earlier" is by posting order, so reprinting challan 1 after challan 2 has
 * gone still prints what challan 1 said on the day.
 */
export async function printView(id) {
  const issue = await prisma.fabricIssue.findFirst({
    where: { id, deletedAt: null },
    include: {
      ...INCLUDE,
      vendor: {
        select: {
          id: true,
          vendorCode: true,
          vendorName: true,
          address: true,
          pinCode: true,
          gstNo: true,
          phone: true,
        },
      },
      jobWork: {
        select: {
          id: true,
          dyeIssueNo: true,
          issueDate: true,
          qty: true,
          uom: true,
          address: true,
          pinCode: true,
          challans: {
            where: { deletedAt: null },
            select: { id: true, issueNo: true, fabricQtyIssued: true, postedAt: true, createdAt: true },
          },
        },
      },
    },
  });
  if (!issue) throw ApiError.notFound('Fabric issue');

  const job = issue.jobWork;
  let po = null;
  if (job) {
    const at = (c) => (c.postedAt ?? c.createdAt).getTime();
    const mine = at(issue);
    const earlier = job.challans.filter(
      (c) => c.id !== issue.id && (at(c) < mine || (at(c) === mine && c.issueNo < issue.issueNo)),
    );
    const before = earlier.reduce((sum, c) => sum.plus(D(c.fabricQtyIssued)), D(0));
    const afterThis = before.plus(D(issue.fabricQtyIssued));
    po = {
      jobWorkNo: job.dyeIssueNo,
      date: job.issueDate,
      orderedQty: D(job.qty).toFixed(4),
      previouslySentQty: before.toFixed(4),
      thisChallanQty: D(issue.fabricQtyIssued).toFixed(4),
      sentToDateQty: afterThis.toFixed(4),
      balanceQty: D(job.qty).minus(afterThis).toFixed(4),
      challanSeq: earlier.length + 1,
      uom: job.uom,
    };
  }

  const roll = issue.roll;
  return {
    documentTitle: CHALLAN_TITLE[issue.purpose] ?? 'FABRIC ISSUE SLIP',
    challanNo: issue.issueNo,
    issueDate: issue.issueDate,
    purpose: issue.purpose,
    status: issue.status,
    vendor: issue.vendor
      ? {
          label: 'Job worker',
          name: issue.vendor.vendorName,
          code: issue.vendor.vendorCode,
          address: job?.address ?? issue.vendor.address,
          pinCode: job?.pinCode ?? issue.vendor.pinCode,
          gstNo: issue.vendor.gstNo,
          phone: issue.vendor.phone,
        }
      : null,
    fabric: {
      rollNo: roll.rollNo,
      fabricName: issue.fabricName ?? roll.fabricName,
      colourCode: issue.colorCode ?? roll.colorCode,
      content: roll.content,
      count: roll.count,
      construction: roll.construction,
      width: roll.width,
      gsm: roll.gsm,
    },
    line: {
      qty: D(issue.fabricQtyIssued).toFixed(4),
      uom: issue.uom,
      from: issue.location,
      to: issue.inProcessLocation,
    },
    po,
    references: {
      orderNo: issue.order?.orderNo ?? null,
      buyerName: issue.order?.buyer?.buyerName ?? null,
      styleNo: issue.style?.styleNo ?? null,
    },
    issuedBy: issue.issuedByName,
    remarks: issue.remarks,
    signatures: ['Issued By', 'Authorised By', 'Received By (Vendor)'],
    printedAt: new Date().toISOString(),
  };
}

// ===========================================================================
//  THE POSTING - one transaction, or nothing
// ===========================================================================

/**
 * Issues fabric off a roll.
 *
 * The whole act is one transaction: availability check, issue row, ledger OUT,
 * roll balance, roll stage, balance cache. A failure anywhere unwinds all of
 * it, including the issue number, because the sequence is incremented on the
 * same client.
 *
 * @param {object} input
 * @param {{userId: string, fullName: string}} actor
 */
/**
 * ONE BAG, ONE SHADE - applied to the cutting challan line.
 *
 * Reads the issues already posted against the line and judges the roll by
 * domain/shade.js. A mismatch is refused unless the request carries a reason,
 * which is returned so the issue can store it. Run once for a fast refusal and
 * again on the transaction, the same as the line's quantity check - two
 * storemen may be starting the same line with different rolls at once.
 */
async function assertShadeConsistent(client, lineId, roll, reasonText) {
  const established = await client.fabricIssue.findMany({
    where: { cuttingChallanLineId: lineId, deletedAt: null, postedAt: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: { issueNo: true, shade: true, dyeLot: true, roll: { select: { rollNo: true } } },
  });
  const verdict = assessShadeMix(
    roll,
    established.map((e) => ({ issueNo: e.issueNo, rollNo: e.roll?.rollNo, shade: e.shade, dyeLot: e.dyeLot })),
  );
  if (verdict.ok) return { verdict, mixReason: null };

  const mixReason = acceptedMixReason(reasonText);
  if (!mixReason) {
    throw new ApiError(409, verdict.message, {
      code: ERROR_CODES.SHADE_MIX,
      details: {
        field: 'shadeMixReason',
        reference: verdict.reference,
        conflicts: verdict.conflicts,
        minReasonLength: MIN_MIX_REASON,
      },
    });
  }
  return { verdict, mixReason };
}

export async function create(input, actor) {
  await validateDropdowns(input);

  const roll = await resolveRoll(input.rollId);
  const order = await resolveOrder(input.orderId);
  const employee = await resolveIssuer(input.issuedByEmployeeId, input.issuedByName);
  const vendor = await resolveJobWorker(input.vendorId, input.purpose);

  const styleId = input.styleId ?? order.styleId;
  if (!styleId) {
    throw ApiError.badRequest('Name the style the fabric is being issued for', {
      field: 'styleId',
    });
  }

  const qty = D(input.fabricQtyIssued);
  if (!qty.greaterThan(0)) {
    throw ApiError.badRequest('Issue quantity must be greater than zero', {
      field: 'fabricQtyIssued',
    });
  }

  const inward = isReturn(input.purpose);

  /**
   * C3 - FABRIC CANNOT REACH A JOB WORKER ON A BARE ISSUE.
   *
   * An approved Job Work order has to exist for the roll first. Resolved
   * before the transaction so the refusal is fast, and re-resolved inside it
   * so two issues cannot spend one authorisation.
   */
  const jobWorkOrder = requiresJobWorkOrder(input.purpose)
    ? await assertJobWorkAuthorised(prisma, {
        rollId: input.rollId,
        purpose: input.purpose,
        vendorId: vendor?.id ?? null,
        qty,
      })
    : null;

  /**
   * Where the movement lands.
   *
   * For an issue that is where the fabric is coming FROM; for a return it is
   * the store it is coming BACK to, which is why a return does not default to
   * the roll's current location - that is the cutting floor it is leaving.
   */
  /**
   * Where the fabric is coming OUT of.
   *
   * THE MAIN STORE, not `roll.location`. Under C3 and C6 a roll can be in two
   * places at once - three hundred metres on the cutting floor and the rest
   * still on the rack - and `roll.location` records only where its LAST
   * movement sent it. Reading it here meant the second issue off a
   * part-issued roll tried to draw from the cutting floor and was refused for
   * insufficient stock, with the fabric sitting in the store all along.
   *
   * A caller may still name a location explicitly; what it may not do is
   * inherit one from a roll that is no longer in a single place.
   */
  const from = input.location ?? DEFAULT_LOCATION;

  /**
   * C3 / C6 - where the fabric is going, when it is not leaving the books.
   *
   * Dyeing and printing send it to a job worker; cutting sends it to the
   * cutting floor. In all three cases the company still owns the cloth, so the
   * movement is a TRANSFER and not a disappearance: an OUT of `from` and an IN
   * at `inProcessTo`, both inside this transaction.
   *
   * Null for the purposes that genuinely consume stock (SAMPLING) and for a
   * return, which is already coming home.
   */
  const destination = LOCATION_FOR_PURPOSE[input.purpose] ?? null;
  const inProcessTo =
    !inward && destination && destination !== from && !isAvailableForIssue(destination)
      ? destination
      : null;

  // Checked once here so an obviously impossible issue fails fast on the phone,
  // and again inside the transaction below - which is the check that counts.
  // A return adds stock, so there is nothing to be short of.
  if (!inward) {
    assertAvailable(await checkAvailability(prisma, { roll, qty, location: from }));
  }

  /**
   * C5 - THE CUTTING CHALLAN LINE THIS ISSUE FULFILS.
   *
   * Required on every new issue. Checked here for a fast refusal and again on
   * the transaction, which is the check that counts - two store keepers
   * issuing against the same line at the same moment both pass this one.
   *
   * A RETURN is exempt: it is this document run backwards, putting cloth back
   * on the rack, and there is no requirement being fulfilled by it.
   */
  /**
   * WHICH AUTHORISATION APPLIES DEPENDS ON WHERE THE FABRIC IS GOING.
   *
   *   to the CUTTING FLOOR   -> an approved Cutting Challan line   (C5)
   *   to a JOB WORKER        -> an approved Job Work order         (C3)
   *   back to the store      -> neither; a return fulfils nothing
   *
   * Requiring a challan line on a dyeing issue as well was wrong, and the
   * end-to-end test is what caught it: the cutting department does not raise
   * requirements for cloth going to a dye house, so no such line can exist and
   * fabric could never have reached a job worker at all.
   */
  const needsChallanLine = !inward && !requiresJobWorkOrder(input.purpose);

  if (needsChallanLine) {
    if (!input.cuttingChallanLineId) {
      throw ApiError.badRequest(
        'A fabric issue to the cutting floor must quote the approved cutting challan line it ' +
          'fulfils. The cutting department raises the requirement first; the store issues ' +
          'against it.',
        { field: 'cuttingChallanLineId', purpose: input.purpose },
      );
    }
    await assertLineCanTake(prisma, input.cuttingChallanLineId, qty);
    await assertShadeConsistent(prisma, input.cuttingChallanLineId, roll, input.shadeMixReason);
  }

  const issueId = await prisma.$transaction(async (tx) => {
    /*
     * LOCK THE ROLL, THEN READ IT.
     *
     * -----------------------------------------------------------------------
     *  This used to be a bare re-read on the transaction client, commented
     *  "only one passes this one". It was not true. `resolveRoll()` is an
     *  ordinary `findFirst`, and under READ COMMITTED two storemen issuing the
     *  same roll both read the same committed balance and both went on to
     *  write. The variable was called `locked` and nothing was locked, which is
     *  the reason the defect survived review - a reader checking for a lock
     *  found the word and stopped looking.
     *
     *  `FOR UPDATE` is taken BEFORE the read so the balance this transaction
     *  goes on to reason about cannot change underneath it. The second storeman
     *  waits here until the first commits, then reads the balance the first one
     *  left. PostgreSQL releases the lock at COMMIT or ROLLBACK, so there is
     *  nothing to unlock on the error paths below.
     *
     *  Scope note: this serialises issues OF THE SAME ROLL only. Two storemen
     *  working different rolls never meet here. The wider (item, location)
     *  serialisation that protects the stock ledger is separate and lives in
     *  `postMovement()`.
     * -----------------------------------------------------------------------
     */
    await tx.$executeRaw`SELECT id FROM fabric_rolls WHERE id = ${input.rollId}::uuid FOR UPDATE`;

    const locked = await resolveRoll(input.rollId, tx);
    if (!inward) {
      assertAvailable(await checkAvailability(tx, { roll: locked, qty, location: from }));
      if (needsChallanLine) await assertLineCanTake(tx, input.cuttingChallanLineId, qty);
    }
    const shadeCheck = needsChallanLine
      ? await assertShadeConsistent(tx, input.cuttingChallanLineId, locked, input.shadeMixReason)
      : { mixReason: null };

    // C3: re-resolve the job work authorisation on the transaction too.
    const authorised = jobWorkOrder
      ? await assertJobWorkAuthorised(tx, {
          rollId: input.rollId,
          purpose: input.purpose,
          vendorId: vendor?.id ?? null,
          qty,
        })
      : null;

    const issueNo = input.issueNo?.trim() || (await nextNumber('FABRIC_ISSUE', { tx }));
    const clash = await tx.fabricIssue.findUnique({ where: { issueNo }, select: { id: true } });
    if (clash) throw ApiError.conflict('This issue number already exists', { field: 'issueNo' });

    const issueDate = input.issueDate ? new Date(input.issueDate) : new Date();
    const postedAt = new Date();

    const issue = await tx.fabricIssue.create({
      data: {
        issueNo,
        issueDate,
        vendorId: vendor?.id ?? null,
        rollId: locked.id,
        purpose: input.purpose,
        orderId: order.id,
        styleId,
        issuedByEmployeeId: employee?.id ?? null,
        issuedByName: employee?.empName ?? input.issuedByName,
        fabricQtyIssued: qty,
        // Excel: "Fabric name" and "Color Code" are attributes of the roll, not
        // of the issue. Copied from it rather than retyped on a phone.
        fabricName: input.fabricName ?? locked.fabricName,
        colorCode: input.colorCode ?? locked.colorCode,
        uom: input.uom ?? locked.uom,
        status: 'IN_PROGRESS',
        remarks: input.remarks ?? null,
        location: from,
        // C5 - the requirement this issue fulfils.
        cuttingChallanLineId: needsChallanLine ? input.cuttingChallanLineId : null,
        // The roll's shade and lot as issued, and the reason if this issue
        // knowingly mixed them on its line.
        shade: locked.shade ?? null,
        dyeLot: locked.dyeLot ?? null,
        shadeMixReason: shadeCheck.mixReason,
        // The job work order (PO) this challan draws on.
        jobWorkId: authorised?.id ?? null,
        // C3 / C6 - where the fabric goes TO, when it is going somewhere the
        // company still owns it. Null on a return and on the purposes that
        // genuinely consume stock.
        inProcessLocation: inward ? null : (inProcessTo ?? null),
        inventoryItemId: locked.inventoryItemId,
        postedAt,
        postedById: actor.userId,
        postedByName: actor.fullName,
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });

    // THE stock ledger movement - OUT for an issue, IN for a return.
    // postMovement re-checks availability itself on an OUT, and recomputes the
    // balance from the ledger afterwards either way.
    const leg1 = await postMovement(tx, {
      itemId: locked.inventoryItemId,
      rollId: locked.id,
      direction: inward ? 'IN' : 'OUT',
      qty,
      rate: locked.rate ?? 0,
      entryDate: issueDate,
      location: from,
      documentType: 'FABRIC_ISSUE',
      documentId: issue.id,
      documentNo: issue.issueNo,
      orderId: order.id,
      snapshot: {
        itemCategory: locked.inventoryItem?.itemCategory ?? 'Fabric',
        colorCode: locked.colorCode,
        gsm: locked.gsm,
        content: locked.content,
        uom: locked.uom,
      },
      remarks: inward
        ? `Returned to ${from} against ${order.orderNo}`
        : `Issued for ${input.purpose.toLowerCase()} against ${order.orderNo}` +
          (vendor ? ` to ${vendor.vendorName}` : ''),
      actor,
    });

    /**
     * C3 / C6 - THE SECOND LEG.
     *
     * The fabric has left the store; this puts it where it actually is. Same
     * transaction, same quantity, same roll, so the two legs commit together
     * or not at all and the ledger can never show cloth that left one place
     * without arriving at another.
     *
     * The consequence is the one C3 asks for: fabric at a dye house stays
     * visible in total on hand, and stays out of available-for-issue, because
     * `postMovement()` checks availability per location and nobody can issue
     * from AT DYEING VENDOR.
     */
    if (inProcessTo) {
      await postMovement(tx, {
        itemId: locked.inventoryItemId,
        rollId: locked.id,
        direction: 'IN',
        qty,
        rate: locked.rate ?? 0,
        // FIFO - a transfer, not a purchase: the cloth arrives at the floor or
        // the dye house at the cost and age it left the store with.
        carryCost: leg1.consumed,
        entryDate: issueDate,
        location: inProcessTo,
        documentType: 'FABRIC_ISSUE',
        documentId: issue.id,
        documentNo: issue.issueNo,
        orderId: order.id,
        snapshot: {
          itemCategory: locked.inventoryItem?.itemCategory ?? 'Fabric',
          colorCode: locked.colorCode,
          gsm: locked.gsm,
          content: locked.content,
          uom: locked.uom,
        },
        remarks:
          `Received at ${inProcessTo} from ${from} on ${issue.issueNo}` +
          (vendor ? ` (${vendor.vendorName})` : ''),
        actor,
      });
    }

    /**
     * C5 - the challan line's issued total, RE-DERIVED from the issues that
     * quote it, inside this transaction. An issue that rolls back takes its
     * contribution with it.
     */
    if (needsChallanLine) {
      await recomputeLineFulfilment(tx, input.cuttingChallanLineId);
    }

    /**
     * C3 - the job work order is now at the vendor. Stamped and moved to
     * POSTED in the same transaction as the movement that put it there, so
     * `stockPostedAt` is never true of a lot whose fabric did not move.
     */
    if (authorised) {
      // What has gone out on this order - RE-DERIVED from its challans, this
      // one included, never incremented from a number a caller supplied.
      const sent = await tx.fabricIssue.aggregate({
        where: { jobWorkId: authorised.id, deletedAt: null },
        _sum: { fabricQtyIssued: true },
      });
      const issuedQty = D(sent._sum.fabricQtyIssued ?? 0);
      const firstChallan = authorised.workflowState === 'APPROVED';

      /*
       * C16 - the ROLL's running total, re-derived the same way.
       *
       * Counted from the challans for this job AND this roll, never
       * incremented, for the reason the header total is re-derived: a
       * reversed or deleted challan has to take its quantity back with it,
       * and an increment cannot. This is the figure
       * assertJobWorkAuthorised() measures the next challan against, so
       * getting it from the challans themselves is what keeps the
       * authorisation honest.
       */
      const sentOnRoll = await tx.fabricIssue.aggregate({
        where: { jobWorkId: authorised.id, rollId: locked.id, deletedAt: null },
        _sum: { fabricQtyIssued: true },
      });
      await tx.dyeIssueRoll.updateMany({
        where: { dyeIssueId: authorised.id, rollId: locked.id, deletedAt: null },
        data: {
          issuedQty: D(sentOnRoll._sum.fabricQtyIssued ?? 0),
          updatedById: actor.userId ?? null,
        },
      });

      await tx.dyeIssue.update({
        where: { id: authorised.id },
        data: {
          issuedQty,
          ...(firstChallan
            ? {
                fabricIssueId: issue.id,
                inventoryItemId: locked.inventoryItemId,
                jobWorkerLocation: inProcessTo ?? destination ?? 'WITH JOB WORKER',
                stockPostedAt: postedAt,
                stockPostedById: actor.userId ?? null,
                stockPostedByName: actor.fullName ?? null,
              }
            : {}),
          updatedById: actor.userId ?? null,
        },
      });

      // The first challan puts the order at the vendor. Later ones add to it.
      if (firstChallan) {
        await engine.post(tx, {
          documentType: 'DYE_ISSUE',
          documentId: authorised.id,
          actor,
          remarks:
            `${qty.toFixed(4)} ${locked.uom} of roll ${locked.rollNo} issued on ` +
            `${issue.issueNo} and now held at ${inProcessTo ?? destination}.`,
        });
      }
    }

    // The roll follows the fabric: what is left on it, where it now is, and
    // what stage of the pipeline it has reached.
    const remaining = inward
      ? D(locked.balanceQty).plus(qty)
      : D(locked.balanceQty).minus(qty);

    await tx.fabricRoll.update({
      where: { id: locked.id },
      data: {
        /*
         * ATOMIC, NOT AN ABSOLUTE WRITE.
         *
         * `remaining` above is correct - the roll row is locked, so the balance
         * it was computed from cannot have moved. This is written as a relative
         * change anyway, and the reason is what happens if that lock is ever
         * removed or bypassed.
         *
         * An absolute write says "the balance is now 40". Two of them racing
         * both say 40, both are accepted, and 120 Mtrs leave a 100 Mtr roll
         * with every CHECK constraint satisfied - 40 is a legal balance. A
         * relative write says "take 60 off whatever is there", which PostgreSQL
         * serialises on the row, and the second one drives the balance to -20
         * where `fabric_rolls_balance_non_negative` refuses it.
         *
         * So the lock keeps this correct and the atomic form keeps the database
         * able to notice if it ever stops being. See
         * test/concurrency.stock.test.js, which asserts both halves.
         */
        balanceQty: inward ? { increment: qty } : { decrement: qty },
        // A roll at zero has been consumed - but only if it got there by being
        // issued out. A return can never leave a roll empty, and must never
        // mark one CONSUMED.
        stage:
          !inward && remaining.isZero()
            ? (STAGE_FOR_PURPOSE[input.purpose] ?? 'CONSUMED')
            : (STAGE_FOR_PURPOSE[input.purpose] ?? locked.stage),
        location: LOCATION_FOR_PURPOSE[input.purpose] ?? locked.location,
        updatedById: actor.userId,
      },
    });

    return issue.id;
  });

  return getById(issueId);
}

/**
 * Edits the descriptive part of an issue.
 *
 * The quantity, the roll and the order are absent: they are already in the
 * stock ledger, which is append-only. An issue keyed wrongly is corrected by a
 * return, not by editing what the ledger recorded.
 */
export async function update(id, input, actorId) {
  const issue = await prisma.fabricIssue.findFirst({ where: { id, deletedAt: null } });
  if (!issue) throw ApiError.notFound('Fabric issue');

  await validateDropdowns(input);

  const updated = await prisma.fabricIssue.update({
    where: { id },
    data: {
      ...(input.issueDate !== undefined ? { issueDate: new Date(input.issueDate) } : {}),
      ...(input.fabricName !== undefined ? { fabricName: input.fabricName } : {}),
      ...(input.colorCode !== undefined ? { colorCode: input.colorCode } : {}),
      ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
      updatedById: actorId,
    },
    include: LIST_INCLUDE,
  });

  return project(updated);
}

/**
 * Moves an issue's fulfilment status.
 *
 * A posted issue cannot be cancelled: the fabric has left the rack and the
 * ledger says so. What the status is for is the rest of the lifecycle - a lot
 * put on hold, or closed off once the cutting floor has finished with it.
 */
export async function setStatus(id, { status, remarks }, actorId) {
  const issue = await prisma.fabricIssue.findFirst({ where: { id, deletedAt: null } });
  if (!issue) throw ApiError.notFound('Fabric issue');

  engine.assertStatusTransition(issue.status, status, { label: issue.issueNo });

  if (status === 'CANCELLED' && issue.postedAt) {
    throw ApiError.conflict(
      `${issue.issueNo} is posted: the fabric has left the store and the ledger says so. ` +
        'A posted issue is corrected by a return, not by a status change.',
    );
  }

  const updated = await prisma.fabricIssue.update({
    where: { id },
    data: {
      status,
      ...(remarks !== undefined ? { remarks } : {}),
      updatedById: actorId,
    },
    include: LIST_INCLUDE,
  });

  return project(updated);
}

/** Deletes an issue that never reached the ledger. A posted one cannot go. */
export async function remove(id, actorId) {
  const issue = await prisma.fabricIssue.findFirst({ where: { id, deletedAt: null } });
  if (!issue) throw ApiError.notFound('Fabric issue');

  const usage = await downstreamUsage(id);
  if (issue.postedAt || usage.movements > 0) {
    throw ApiError.conflict(
      `${issue.issueNo} is posted: the fabric has left stock and the ledger says so. ` +
        'A posted issue is corrected by a return, not by deletion.',
      { usage, postedAt: issue.postedAt },
    );
  }
  if (usage.total > 0) {
    throw ApiError.conflict(
      `${issue.issueNo} has ${usage.jobWorks} job work issue(s) and ${usage.cuttingIssues} ` +
        'cutting challan(s) against it.',
      { usage },
    );
  }

  await prisma.fabricIssue.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: actorId },
  });
  return { deleted: true };
}

// ---------------------------------------------------------------------------
//  The shop-floor helpers
// ---------------------------------------------------------------------------

/**
 * "Can I issue this much off this roll?" - answered before anything is saved,
 * by the same code the save runs.
 *
 * Also returns everything the form should fill in from the roll, so a storeman
 * on a phone types a quantity and nothing else.
 */
export async function preview({ rollId, fabricQtyIssued, purpose, location, cuttingChallanLineId }) {
  const roll = await resolveRoll(rollId);
  const inward = isReturn(purpose);
  const from = location ?? (inward ? DEFAULT_LOCATION : roll.location) ?? DEFAULT_LOCATION;

  /**
   * A return has no availability question to answer, and asking it anyway
   * produced the wrong answer loudly: the screen refused to let the cutting
   * floor hand back cloth off a roll it had already emptied.
   *
   * `permitted: true` rather than a null, so the shop-floor screen - which
   * reads this to decide whether to enable the confirm button - needs no
   * special case for the one purpose that always can proceed.
   */
  const availability = inward
    ? {
        permitted: true,
        inward: true,
        rollNo: roll.rollNo,
        uom: roll.uom,
        requested: D(fabricQtyIssued ?? 0).toFixed(4),
        rollBalance: D(roll.balanceQty).toFixed(4),
        note: 'A return adds to stock, so there is nothing to be short of.',
      }
    : await checkAvailability(prisma, {
        roll,
        qty: fabricQtyIssued ?? 0,
        location: from,
      });

  /*
   * The shade question, asked before the storeman commits - so the phone can
   * say "this roll is lot B, the line was started on lot A" while there is
   * still a chance to fetch the right roll instead.
   */
  let shade = null;
  if (cuttingChallanLineId && !inward) {
    const established = await prisma.fabricIssue.findMany({
      where: { cuttingChallanLineId, deletedAt: null, postedAt: { not: null } },
      orderBy: { createdAt: 'asc' },
      select: { issueNo: true, shade: true, dyeLot: true, roll: { select: { rollNo: true } } },
    });
    shade = assessShadeMix(
      roll,
      established.map((e) => ({ issueNo: e.issueNo, rollNo: e.roll?.rollNo, shade: e.shade, dyeLot: e.dyeLot })),
    );
  }

  return {
    shade,
    roll: {
      id: roll.id,
      rollNo: roll.rollNo,
      shadeBand: roll.shade,
      dyeLot: roll.dyeLot,
      fabricName: roll.fabricName,
      colorCode: roll.colorCode,
      content: roll.content,
      count: roll.count,
      construction: roll.construction,
      width: roll.width,
      gsm: roll.gsm,
      uom: roll.uom,
      receivedQty: D(roll.receivedQty).toFixed(4),
      balanceQty: D(roll.balanceQty).toFixed(4),
      rate: roll.rate,
      stage: roll.stage,
      location: roll.location,
      itemCode: roll.inventoryItem?.itemCode ?? null,
      grnNo: roll.grn?.grnNo ?? null,
      vendorName: roll.vendor?.vendorName ?? null,
    },
    availability,
    /** Where the roll will be after this movement, so the screen can say so. */
    willMoveTo: purpose ? (LOCATION_FOR_PURPOSE[purpose] ?? from) : null,
    willBecomeStage: purpose ? (STAGE_FOR_PURPOSE[purpose] ?? roll.stage) : null,
    needsJobWorker: purpose === 'DYEING' || purpose === 'PRINTING',
    /** Whether this movement puts stock back rather than taking it out. */
    isReturn: inward,
    nextIssueNo: await peekNumber('FABRIC_ISSUE'),
  };
}

/**
 * The roll picker.
 *
 * One call, everything the phone needs to render a list of rolls a storeman can
 * actually issue from: in stock, not held, not rejected, with the fabric
 * attributes and the balance already on each row.
 */
export async function rollOptions({ orderId, colorCode, stage, location, includeEmpty } = {}) {
  const rolls = await prisma.fabricRoll.findMany({
    where: {
      deletedAt: null,
      isHeld: false,
      stage: stage ? { equals: stage } : { notIn: ['REJECTED', 'CONSUMED'] },
      ...(includeEmpty ? {} : { balanceQty: { gt: 0 } }),
      ...(colorCode ? { colorCode } : {}),
      ...(location ? { location } : {}),
    },
    orderBy: [{ stage: 'asc' }, { rollNo: 'asc' }],
    take: OPTIONS_LIMIT,
    select: {
      id: true,
      rollNo: true,
      fabricName: true,
      colorCode: true,
      content: true,
      count: true,
      gsm: true,
      width: true,
      uom: true,
      receivedQty: true,
      balanceQty: true,
      rate: true,
      stage: true,
      location: true,
      shade: true,
      dyeLot: true,
      inventoryItem: { select: { id: true, itemCode: true, description: true } },
      grn: {
        select: {
          id: true,
          grnNo: true,
          purchaseOrder: {
            select: { id: true, poId: true, order: { select: { id: true, orderNo: true } } },
          },
        },
      },
    },
  });

  // An order narrows the list to rolls bought for it, but never hides the rest:
  // a storeman substituting fabric across orders is normal, and a picker that
  // silently omits a roll they are holding is worse than one that flags it.
  return rolls.map((r) => ({
    ...r,
    poId: r.grn?.purchaseOrder?.poId ?? null,
    orderNo: r.grn?.purchaseOrder?.order?.orderNo ?? null,
    forThisOrder: orderId ? r.grn?.purchaseOrder?.order?.id === orderId : null,
    label:
      `${r.rollNo} - ${[r.fabricName, r.colorCode, r.gsm].filter(Boolean).join(' / ')} ` +
      (r.shade || r.dyeLot
        ? `[${[r.shade && `shade ${r.shade}`, r.dyeLot && `lot ${r.dyeLot}`].filter(Boolean).join(', ')}] `
        : '') +
      `(${D(r.balanceQty).toFixed(2)} ${r.uom})`,
  }));
}
