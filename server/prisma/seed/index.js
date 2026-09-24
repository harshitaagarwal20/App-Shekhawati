/**
 * ===========================================================================
 *  SHEKHAWATI IMPEX ERP - DATABASE SEED
 * ===========================================================================
 *
 *  Loads the master lists, RBAC catalogue, record masters and the workbook
 *  sample transactions, then derives inventory items, the stock ledger, stock
 *  balances and the approval trail from those documents.
 *
 *  The seed is destructive and idempotent: it clears every in-scope table in
 *  reverse dependency order and rebuilds it. Run with `npm run db:seed`.
 * ===========================================================================
 */

import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

import { masterLists } from './data/masterLists.js';
// C2 / C3 / C9 - the seeder resolves its figures from the same masters and the
// same shared calculation the services use, so a seeded database is judged by
// exactly the numbers a real one is. Nothing here restates a percentage.
import { categoryOf } from '../../src/domain/itemCategory.js';
import {
  expectedReturnQty,
  resolveCategoryTolerance,
  resolveShrinkage,
} from '../../src/services/tolerance.service.js';
import { roles, buildPermissions } from './data/rbac.js';
import { buyers, vendors, employees, styles } from './data/masters.js';
import {
  buyerOrders,
  plannings,
  vendorQuotations,
  purchaseOrders,
  gatePasses,
  grns,
  fabricRolls,
  fabricIssues,
  dyeIssues,
  dyeingReceipts,
  printings,
  fabricScrutinies,
  planApprovals,
  cuttingIssues,
  documentSequences,
  excessRules,
} from './data/transactions.js';

dotenv.config();

const prisma = new PrismaClient();
const D = (v) => (v === null || v === undefined ? null : new Prisma.Decimal(v));
const dec = (v) => new Prisma.Decimal(v);
const date = (v) => (v ? new Date(`${v}T00:00:00.000Z`) : null);

/**
 * C9 - the day the seeded masters start applying.
 *
 * Earlier than every transaction in the seed, so that every seeded document
 * resolves the BOM version and the tolerance version that were actually in
 * force on its own date. A later epoch would leave documents dated before
 * their own BOM line, which resolves to nothing.
 */
const SEED_EPOCH = '2026-08-01';

const MAIN_STORE = 'MAIN STORE';

/** General material receipt tolerance and the tighter accessories tolerance. */
const TOLERANCE = { DEFAULT: 0.02, ACCESSORIES: 0.03 };

function log(step) {
  process.stdout.write(`  - ${step}\n`);
}

// ---------------------------------------------------------------------------
//  0. WIPE  (reverse dependency order)
// ---------------------------------------------------------------------------
async function wipe() {
  const order = [
    'stockLedger',
    'stockBalance',
    'cuttingIssue',
    'excessApproval',
    'excessRule',
    'planApproval',
    'fabricScrutiny',
    'printing',
    'dyeingReceipt',
    'gatePass',
    'dyeIssue',
    'fabricIssue',
    'fabricRoll',
    'grn',
    'purchaseOrder',
    'vendorQuotation',
    'planningLine',
    'planning',
    'buyerOrder',
    'inventoryItem',
    'styleBomLine',
    'style',
    'userSession',
    'userRole',
    'rolePermission',
    'user',
    'role',
    'permission',
    'employee',
    'vendor',
    'buyer',
    'masterListValue',
    'masterList',
    'approvalHistory',
    'documentAmendment',
    'auditLog',
    'documentSequence',
  ];
  for (const model of order) {
    await prisma[model].deleteMany({});
  }
  log(`cleared ${order.length} tables`);
}

// ---------------------------------------------------------------------------
//  1. MASTER LISTS
// ---------------------------------------------------------------------------
async function seedMasterLists() {
  let valueCount = 0;
  for (const list of masterLists) {
    await prisma.masterList.create({
      data: {
        code: list.code,
        name: list.name,
        description: list.description,
        isSystem: true,
        values: {
          // A value is usually just a label. Some lists carry data with it -
          // a GST slab needs the fraction to charge, not only the text to
          // show - and those arrive as objects rather than strings.
          create: list.values.map((entry, i) => {
            const v = typeof entry === 'string' ? { value: entry } : entry;
            return {
              value: v.value,
              code: v.code ?? v.value,
              sortOrder: (i + 1) * 10,
              ...(v.attributes ? { attributes: v.attributes } : {}),
            };
          }),
        },
      },
    });
    valueCount += list.values.length;
  }
  log(`master lists: ${masterLists.length} lists / ${valueCount} values`);
}

// ---------------------------------------------------------------------------
//  2. ROLES, PERMISSIONS, USERS
// ---------------------------------------------------------------------------
function matchPermission(pattern, permission) {
  if (pattern === '*') return true;
  const [pModule, pAction] = pattern.split('.');
  const moduleOk = pModule === '*' || pModule === permission.module;
  const actionOk = pAction === '*' || pAction === permission.action;
  return moduleOk && actionOk;
}

async function seedRbac() {
  const permissionDefs = buildPermissions();
  await prisma.permission.createMany({ data: permissionDefs });
  const permissions = await prisma.permission.findMany();
  log(`permissions: ${permissions.length}`);

  let linkCount = 0;
  for (const roleDef of roles) {
    const role = await prisma.role.create({
      data: {
        code: roleDef.code,
        name: roleDef.name,
        description: roleDef.description,
        isSystem: roleDef.isSystem,
      },
    });
    const patterns = roleDef.permissions === '*' ? ['*'] : roleDef.permissions;
    const granted = permissions.filter((p) => patterns.some((pat) => matchPermission(pat, p)));
    if (granted.length) {
      await prisma.rolePermission.createMany({
        data: granted.map((p) => ({ roleId: role.id, permissionId: p.id })),
      });
      linkCount += granted.length;
    }
  }
  log(`roles: ${roles.length} / role-permission grants: ${linkCount}`);
}

/**
 * One login per role, mapped onto the Employee Master person who performs that
 * role in the workbook. Passwords come from .env; never commit real ones.
 */
const USERS = [
  { username: 'admin', fullName: 'System Administrator', email: 'admin@shekhawatiimpex.local', roleCodes: ['ADMIN'], empId: null, isAdmin: true },
  { username: 'dinesh', fullName: 'Dinesh Sir', email: 'dinesh@shekhawatiimpex.local', roleCodes: ['DIRECTOR'], empId: 'EMP-009' },
  { username: 'vinay', fullName: 'Vinay Sharma', email: 'vinay@shekhawatiimpex.local', roleCodes: ['MERCHANDISING'], empId: 'EMP-006' },
  { username: 'ravi', fullName: 'Ravi Prajapat', email: 'ravi@shekhawatiimpex.local', roleCodes: ['STORE_MANAGER'], empId: 'EMP-008' },
  { username: 'maharaj', fullName: 'Maharaj Singh', email: 'maharaj@shekhawatiimpex.local', roleCodes: ['STORE_MANAGER'], empId: 'EMP-001' },
  { username: 'sunita', fullName: 'Sunita Devi', email: 'sunita@shekhawatiimpex.local', roleCodes: ['QC'], empId: 'EMP-004' },
  { username: 'rekha', fullName: 'Rekha Sharma', email: 'rekha@shekhawatiimpex.local', roleCodes: ['QC'], empId: 'EMP-005' },
  { username: 'merch', fullName: 'Merchandising Desk', email: 'merch@shekhawatiimpex.local', roleCodes: ['MERCHANDISING'], empId: null },
  { username: 'headoffice', fullName: 'Head Office Desk', email: 'ho@shekhawatiimpex.local', roleCodes: ['HEAD_OFFICE'], empId: null },
  { username: 'planner', fullName: 'Planning Desk', email: 'planner@shekhawatiimpex.local', roleCodes: ['MERCHANDISING'], empId: null },
];

async function seedUsers(employeeByEmpId) {
  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS || 10);
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'Admin@123';
  const userPassword = process.env.SEED_DEFAULT_USER_PASSWORD || 'Shekhawati@123';
  const adminHash = await bcrypt.hash(adminPassword, saltRounds);
  const userHash = await bcrypt.hash(userPassword, saltRounds);

  const roleRows = await prisma.role.findMany();
  const roleByCode = new Map(roleRows.map((r) => [r.code, r]));

  for (const u of USERS) {
    const user = await prisma.user.create({
      data: {
        username: u.username,
        email: u.email,
        fullName: u.fullName,
        passwordHash: u.isAdmin ? adminHash : userHash,
        mustChangePassword: false,
        employeeId: u.empId ? employeeByEmpId.get(u.empId).id : null,
      },
    });
    await prisma.userRole.createMany({
      data: u.roleCodes.map((code) => ({ userId: user.id, roleId: roleByCode.get(code).id })),
    });
  }
  log(`users: ${USERS.length}`);
}

// ---------------------------------------------------------------------------
//  3. RECORD MASTERS
// ---------------------------------------------------------------------------
async function seedMasters() {
  const buyerByName = new Map();
  for (const b of buyers) {
    const row = await prisma.buyer.create({ data: b });
    buyerByName.set(row.buyerName, row);
  }
  log(`buyers: ${buyers.length}`);

  const vendorByName = new Map();
  for (const v of vendors) {
    const row = await prisma.vendor.create({ data: v });
    vendorByName.set(row.vendorName, row);
  }
  log(`vendors: ${vendors.length}`);

  const employeeByEmpId = new Map();
  const employeeByName = new Map();
  for (const e of employees) {
    const row = await prisma.employee.create({ data: e });
    employeeByEmpId.set(row.empId, row);
    employeeByName.set(row.empName, row);
  }
  log(`employees: ${employees.length}`);

  const styleByNo = new Map();
  let bomCount = 0;
  for (const s of styles) {
    const { bom, buyerName, ...rest } = s;
    const row = await prisma.style.create({
      data: {
        ...rest,
        avgFabricUtilizationPerPc: dec(rest.avgFabricUtilizationPerPc),
        buyerId: buyerByName.get(buyerName).id,
        bomLines: {
          create: bom.map((line, i) => ({
            lineNo: i + 1,
            itemCategory: line.itemCategory,
            subCategory: line.subCategory ?? null,
            accessoriesItem: line.accessoriesItem ?? null,
            description: line.description ?? null,
            colorCode: line.colorCode ?? null,
            content: line.content ?? null,
            gsm: line.gsm ?? null,
            count: line.count ?? null,
            construction: line.construction ?? null,
            uom: line.uom,
            // C9 - the column formerly called qty_per_pc. The seed data still
            // uses the old key because that is what it has always been called
            // in the workbook; the field it lands in is the renamed one.
            avgUtilisationPerPiece: dec(line.avgUtilisationPerPiece ?? line.qtyPerPc),
            // C9 - the day the figure starts applying. The seed represents a
            // system in steady state, so every line is effective from the day
            // the styles were set up.
            effectiveFrom: date(SEED_EPOCH),
            wastagePct: dec(line.wastagePct ?? 0),
            hsnCode: line.hsnCode ?? null,
          })),
        },
      },
    });
    styleByNo.set(row.styleNo, row);
    bomCount += bom.length;
  }
  log(`styles: ${styles.length} / style BOM lines: ${bomCount}`);

  return { buyerByName, vendorByName, employeeByEmpId, employeeByName, styleByNo };
}

// ---------------------------------------------------------------------------
//  4. BUYER ORDERS + PLANNING
// ---------------------------------------------------------------------------
async function seedOrdersAndPlanning(ctx) {
  const orderByNo = new Map();
  for (const o of buyerOrders) {
    const { buyerName, styleNo, ...rest } = o;
    const row = await prisma.buyerOrder.create({
      data: {
        ...rest,
        orderDate: date(o.orderDate),
        buyerDeliveryDate: date(o.buyerDeliveryDate),
        orderQty: dec(o.orderQty),
        excessPct: dec(o.excessPct),
        // The workbook rows are live orders, not drafts, so their excess is
        // treated as already granted by the Director. effectiveQty is the
        // server-calculated ceiling: orderQty x (1 + approved excess).
        excessApprovalStatus: dec(o.excessPct).greaterThan(0) ? 'APPROVED' : 'NOT_REQUIRED',
        excessApprovedPct: dec(o.excessPct),
        excessJustification: dec(o.excessPct).greaterThan(0)
          ? 'Standard cutting and process allowance for this buyer'
          : null,
        excessApprovedByName: dec(o.excessPct).greaterThan(0) ? 'Dinesh Sir' : null,
        excessApprovedAt: dec(o.excessPct).greaterThan(0) ? date(o.orderDate) : null,
        effectiveQty: dec(o.orderQty).mul(dec(1).plus(dec(o.excessPct))),
        buyerId: ctx.buyerByName.get(buyerName).id,
        styleId: ctx.styleByNo.get(styleNo).id,
      },
    });
    orderByNo.set(row.orderNo, row);
  }
  log(`buyer orders: ${buyerOrders.length}`);

  const planningByOrderNo = new Map();
  let lineCount = 0;
  let n = 0;
  for (const p of plannings) {
    n += 1;
    const order = orderByNo.get(p.orderNo);
    const row = await prisma.planning.create({
      data: {
        planNo: `PLN-${String(n).padStart(3, '0')}`,
        planDepartment: p.planDepartment,
        containerNo: p.containerNo,
        orderId: order.id,
        styleNo: order.styleId ? buyerOrders.find((b) => b.orderNo === p.orderNo).styleNo : '',
        orderQty: order.orderQty,
        planDate: date(p.planDate),
        status: p.status,
        remarks: p.remarks,
        approvalStatus: p.approvalStatus,
        version: p.version,
        // Server-calculated, exactly as planning.service.js derives them: the
        // sum of the lines, never a figure supplied alongside them.
        plannedQty: p.lines.reduce((a, l) => a.plus(dec(l.deliverableSize)), dec(0)),
        plannedCuttingPcs: p.lines.reduce((a, l) => a.plus(dec(l.cuttingPcsAllotted ?? 0)), dec(0)),
        // Workbook plans are live plans: every one appears on the Plan Approval
        // sheet as submitted, so none of them is a draft.
        submittedTo: 'Dinesh Sir',
        submittedByName: 'Vinay ji (GM)',
        submittedAt: date(p.planDate),
        approvedAt: p.approvalStatus === 'APPROVED' ? date(p.planDate) : null,
        approvedByName: p.approvalStatus === 'APPROVED' ? 'Dinesh Sir' : null,
        rejectionReason: p.approvalStatus === 'REJECTED' ? 'See the Plan Approval log' : null,
        lines: {
          create: p.lines.map((l, i) => ({
            lineNo: i + 1,
            lineDate: date(l.lineDate),
            unit: l.unit,
            deliverableSize: dec(l.deliverableSize),
            cuttingPcsAllotted: D(l.cuttingPcsAllotted),
            status: l.status,
            remark: l.remark,
          })),
        },
      },
    });
    planningByOrderNo.set(p.orderNo, row);
    lineCount += p.lines.length;
  }
  log(`plannings: ${plannings.length} / planning lines: ${lineCount}`);

  return { orderByNo, planningByOrderNo };
}

// ---------------------------------------------------------------------------
//  5. QUOTATIONS + PURCHASE ORDERS
// ---------------------------------------------------------------------------
async function seedProcurement(ctx) {
  const quotationByNo = new Map();
  for (const q of vendorQuotations) {
    const { vendorName, orderNo, ...rest } = q;
    // Amount = Qty x Rate, rounded to the stored scale - the same formula
    // vendorQuotation.service.js applies, so the CHECK constraint agrees.
    const amount = dec(q.rateQuoted)
      .mul(dec(q.qty))
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const approved = q.authorisationStatus === 'APPROVED';
    // Multi-line documents: every quotation line belongs to a vendor quote
    // document. A workbook row is a one-line document numbered as the row.
    const qHeader = await prisma.vendorQuotationHeader.create({
      data: {
        quotationNo: q.quotationNo,
        quotationDate: date(q.quotationDate),
        vendorId: ctx.vendorByName.get(vendorName).id,
        orderId: orderNo ? ctx.orderByNo.get(orderNo).id : null,
      },
    });
    const row = await prisma.vendorQuotation.create({
      data: {
        ...rest,
        headerId: qHeader.id,
        lineNo: 1,
        subCategory: q.subCategory ?? null,
        accessoriesItem: q.accessoriesItem ?? null,
        quotationDate: date(q.quotationDate),
        rateQuoted: dec(q.rateQuoted),
        qty: dec(q.qty),
        amount,
        vendorId: ctx.vendorByName.get(vendorName).id,
        orderId: orderNo ? ctx.orderByNo.get(orderNo).id : null,
        approvedAt: approved ? date(q.quotationDate) : null,
        // A settled quotation carries who settled it and, when refused, why.
        // Only PENDING rows are allowed to have no decision at all.
        decidedAt: q.authorisationStatus === 'PENDING' ? null : date(q.quotationDate),
        approvedByName: q.authorisationStatus === 'PENDING' ? null : q.authorisedBy,
        rejectionReason: q.authorisationStatus === 'REJECTED' ? q.remarks : null,
      },
    });
    quotationByNo.set(row.quotationNo, row);
  }
  log(`vendor quotations: ${vendorQuotations.length}`);

  const poByPoId = new Map();
  for (const po of purchaseOrders) {
    const { vendorName, orderNo, styleNo, quotationNo, approvedAt, ...rest } = po;
    // C2 - the commercial category, and BOTH tolerances, frozen on the row as
    // create() does. Resolved from the tolerance master so a seeded database
    // and a real one are judged by exactly the same numbers.
    const poCategory = categoryOf(po.item);
    const poTolerance = await resolveCategoryTolerance(null, {
      category: poCategory,
      on: date(po.poDate),
      itemCategory: po.item,
    });

    const poHeader = await prisma.purchaseOrderHeader.create({
      data: {
        poNo: po.poId,
        poDate: date(po.poDate),
        vendorId: ctx.vendorByName.get(vendorName).id,
        address: po.address ?? null,
        orderId: orderNo ? ctx.orderByNo.get(orderNo).id : null,
      },
    });
    const row = await prisma.purchaseOrder.create({
      data: {
        ...rest,
        headerId: poHeader.id,
        lineNo: 1,
        poDate: date(po.poDate),
        category: poCategory,
        orderTolerancePct: poTolerance.orderTolerance,
        receiptTolerancePct: poTolerance.receiptTolerance,
        toleranceRuleId: poTolerance.ruleId,
        toleranceBasis: poTolerance.basis,
        excessAllowed: dec(po.excessAllowed),
        orderQty: dec(po.orderQty),
        rate: dec(po.rate),
        amount: dec(po.orderQty).mul(dec(po.rate)),
        vendorId: ctx.vendorByName.get(vendorName).id,
        orderId: orderNo ? ctx.orderByNo.get(orderNo).id : null,
        styleId: styleNo ? ctx.styleByNo.get(styleNo).id : null,
        quotationId: quotationNo ? quotationByNo.get(quotationNo).id : null,
        approvedAt: approvedAt ? date(approvedAt) : null,
        // A settled PO carries WHEN it was settled, not only that it was.
        // `purchase_orders_decided_at_present` enforces this: only a PENDING
        // row may have no decision date. The workbook records the approval
        // date, so it is the decision date.
        decidedAt: po.approvalStatus === 'PENDING' ? null : date(approvedAt ?? po.poDate),
      },
    });
    poByPoId.set(row.poId, row);
  }
  log(`purchase orders: ${purchaseOrders.length}`);

  return { quotationByNo, poByPoId };
}

// ---------------------------------------------------------------------------
//  6. GATE PASS + GRN
// ---------------------------------------------------------------------------
async function seedGatePasses(ctx) {
  const gatePassByNo = new Map();
  for (const gp of gatePasses) {
    const qty = dec(gp.qty);
    const received = D(gp.receivedQty);
    const variationPct = qty.isZero() || !received ? dec(0) : qty.minus(received).div(qty);
    const vendor = ctx.vendorByName.get(gp.partyName) ?? null;
    const po = ctx.poByPoId.get(gp.linkedDocNo) ?? null;
    const row = await prisma.gatePass.create({
      data: {
        gatePassNo: gp.gatePassNo,
        gatePassDate: date(gp.gatePassDate),
        type: gp.type,
        linkedDocNo: gp.linkedDocNo,
        purchaseOrderId: po ? po.id : null,
        item: gp.item,
        vendorId: vendor ? vendor.id : null,
        partyName: gp.partyName,
        qty,
        receivedQty: received,
        variationPct,
        // C8 - when the goods actually crossed the gate.
        //
        // Taken as 10:00 local on the gate pass date rather than "now": a gate
        // pass dated three weeks ago whose movement time is the moment the
        // seeder ran would be exactly the createdAt-standing-in-for-movement
        // error C8 exists to remove, reproduced in the demo data.
        movementTime: new Date(`${gp.gatePassDate}T10:00:00Z`),
        uom: gp.uom,
        purpose: gp.purpose,
        authorisedBy: gp.authorisedBy,
        status: gp.status,
        // A cleared pass records who let the goods through and when.
        // `gate_passes_cleared_is_stamped` requires it, and the workbook's
        // "Authorised By" column is the person who did it.
        clearedAt: gp.status === 'CLEARED' ? date(gp.gatePassDate) : null,
        clearedByName: gp.status === 'CLEARED' ? gp.authorisedBy : null,
        remarks: gp.remarks,
      },
    });
    gatePassByNo.set(row.gatePassNo, row);
  }
  log(`gate passes: ${gatePasses.length}`);
  return { gatePassByNo };
}

async function seedGrns(ctx) {
  const grnByNo = new Map();
  for (const g of grns) {
    const po = ctx.poByPoId.get(g.poId);
    const orderQty = dec(g.orderQty);
    const receivingQty = dec(g.receivingQty);
    const variationPct = orderQty.isZero() ? dec(0) : receivingQty.minus(orderQty).div(orderQty);
    const tolerance =
      g.purpose === 'ACCESSORIES' ? TOLERANCE.ACCESSORIES : TOLERANCE.DEFAULT;
    // C2 - the cumulative position this receipt brought the order to, which is
    // what the tolerance is actually measured on.
    const priorReceived = dec(po.receivedQty ?? 0);
    const cumulativeReceived = priorReceived.plus(receivingQty);
    const cumulativeVariationPct = orderQty.isZero()
      ? dec(0)
      : cumulativeReceived.minus(orderQty).div(orderQty).toDecimalPlaces(6);

    const grnHeader = await prisma.grnHeader.create({
      data: {
        grnNo: g.grnNo,
        grnDate: date(g.grnDate),
        vendorId: po.vendorId,
        billNo: g.billNo,
        location: g.location ?? null,
      },
    });
    const row = await prisma.grn.create({
      data: {
        grnNo: g.grnNo,
        headerId: grnHeader.id,
        lineNo: 1,
        purchaseOrderId: po.id,
        // C2 - snapshotted from the order, which froze them at creation.
        category: po.category,
        receiptTolerancePct: po.receiptTolerancePct,
        cumulativeReceivedQty: cumulativeReceived,
        cumulativeVariationPct,
        billNo: g.billNo,
        rollNo: g.rollNo ?? null,
        grnDate: date(g.grnDate),
        purpose: g.purpose,
        item: g.item,
        hsnCode: g.hsnCode,
        vendorId: po.vendorId,
        uom: g.uom,
        orderQty,
        receivingQty,
        inventoryRate: dec(g.inventoryRate),
        // Rounded to the column scale, so the CHECK that recomputes it agrees.
        amount: receivingQty.mul(dec(g.inventoryRate)).toDecimalPlaces(2),
        status: g.status,
        remarks: g.remarks,
        variationPct,
        toleranceBreached: variationPct.greaterThan(dec(tolerance)),
        location: MAIN_STORE,
        gatePassId: g.gatePassNo ? ctx.gatePassByNo.get(g.gatePassNo).id : null,
      },
    });
    grnByNo.set(row.grnNo, row);

    // Keep the PO receipt total in step with what was actually booked.
    await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: { receivedQty: { increment: receivingQty } },
    });
  }
  log(`grns: ${grns.length}`);
  return { grnByNo };
}

// ---------------------------------------------------------------------------
//  7. INVENTORY ITEMS  (derived from the GRN item-defining columns)
// ---------------------------------------------------------------------------
function itemKey(g, po) {
  return [
    po.item,
    po.subCategory ?? '',
    po.accessoriesItem ?? '',
    po.colorCode ?? '',
    po.gsm ?? '',
    po.count ?? '',
    po.uom,
  ].join('|');
}

async function seedInventoryItems(_ctx) {
  const itemByKey = new Map();
  let n = 0;
  for (const g of grns) {
    const poDef = purchaseOrders.find((p) => p.poId === g.poId);
    const key = itemKey(g, poDef);
    if (itemByKey.has(key)) continue;
    n += 1;
    const isFabric = poDef.item === 'Fabric';
    const descParts = [
      poDef.item,
      poDef.subCategory,
      poDef.accessoriesItem,
      poDef.content,
      poDef.gsm,
      poDef.count,
      poDef.colorCode,
    ].filter(Boolean);
    const row = await prisma.inventoryItem.create({
      data: {
        // Same shape as the INVENTORY_ITEM sequence, whose next_number starts
        // past these so a seeded database and a fresh one agree.
        itemCode: `ITM-${String(n).padStart(4, '0')}`,
        description: descParts.join(' / '),
        itemCategory: poDef.item,
        // C2 - resolved once, at the moment the item enters the system.
        category: categoryOf(poDef.item),
        subCategory: poDef.subCategory ?? '',
        accessoriesItem: poDef.accessoriesItem ?? '',
        colorCode: poDef.colorCode ?? '',
        content: poDef.content ?? null,
        gsm: poDef.gsm ?? '',
        count: poDef.count ?? '',
        uom: poDef.uom,
        hsnCode: poDef.hsnCode ?? null,
        isRollTracked: isFabric,
      },
    });
    itemByKey.set(key, row);
  }
  log(`inventory items: ${itemByKey.size}`);
  return { itemByKey };
}

/**
 * Stamps the seeded receipts as posted.
 *
 * The seeder writes each GRN's ledger entry and balance itself, so these
 * receipts ARE in stock - but the GRN rows are created before the inventory
 * items exist, so the item link and the posting stamp have to be filled in
 * afterwards. postedAt is what the application treats as "this receipt reached
 * the ledger", and leaving it null would make seeded stock look unposted.
 */
async function stampGrnPostings(ctx) {
  for (const g of grns) {
    const item = itemForGrn(ctx, g);
    await prisma.grn.update({
      where: { grnNo: g.grnNo },
      data: {
        inventoryItemId: item ? item.id : null,
        postedAt: date(g.grnDate),
        postedByName: 'Seeded from the workbook',
      },
    });
  }
  log(`grns stamped as posted: ${grns.length}`);
}

/** Resolve the inventory item a GRN row belongs to. */
function itemForGrn(ctx, grnDef) {
  const poDef = purchaseOrders.find((p) => p.poId === grnDef.poId);
  return ctx.itemByKey.get(itemKey(grnDef, poDef));
}

/** Resolve the inventory item a fabric roll belongs to (fabric rolls only). */
function itemForRoll(ctx, rollDef) {
  if (rollDef.grnNo) {
    const grnDef = grns.find((g) => g.grnNo === rollDef.grnNo);
    if (grnDef) return itemForGrn(ctx, grnDef);
  }
  // Rolls with no sample GRN: match on the fabric identity columns.
  for (const [key, item] of ctx.itemByKey) {
    const [category, , , colorCode, gsm, count] = key.split('|');
    if (
      category === 'Fabric' &&
      colorCode === (rollDef.colorCode ?? '') &&
      gsm === (rollDef.gsm ?? '') &&
      count === (rollDef.count ?? '')
    ) {
      return item;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
//  8. FABRIC ROLLS
// ---------------------------------------------------------------------------
async function seedFabricRolls(ctx) {
  const rollByNo = new Map();
  for (const r of fabricRolls) {
    const issued = fabricIssues
      .filter((f) => f.rollNo === r.rollNo)
      .reduce((sum, f) => sum.plus(dec(f.fabricQtyIssued)), dec(0));
    const returned = dyeingReceipts
      .filter((d) => d.rollNo === r.rollNo)
      .reduce((sum, d) => sum.plus(dec(d.qtyReceived)), dec(0));
    const balance = dec(r.receivedQty).minus(issued).plus(returned);
    const item = itemForRoll(ctx, r);

    const row = await prisma.fabricRoll.create({
      data: {
        rollNo: r.rollNo,
        grnId: r.grnNo ? ctx.grnByNo.get(r.grnNo).id : null,
        vendorId: ctx.vendorByName.get(r.vendorName).id,
        fabricName: r.fabricName,
        colorCode: r.colorCode,
        content: r.content,
        count: r.count,
        construction: r.construction,
        width: D(r.width),
        gsm: r.gsm,
        uom: r.uom,
        receivedQty: dec(r.receivedQty),
        balanceQty: balance,
        rate: D(r.rate),
        stage: r.stage,
        location: r.stage === 'RAW' ? MAIN_STORE : null,
        isHeld: r.stage === 'SCRUTINY_HOLD',
        inventoryItemId: item ? item.id : null,
        remarks: r.grnNo ? null : 'Roll-to-GRN link not present in the workbook sample data',
      },
    });
    rollByNo.set(row.rollNo, row);
  }
  log(`fabric rolls: ${fabricRolls.length}`);
  return { rollByNo };
}

// ---------------------------------------------------------------------------
//  9. FABRIC ISSUE / DYEING / PRINTING / SCRUTINY
// ---------------------------------------------------------------------------
async function seedProduction(ctx) {
  const issueByNo = new Map();
  for (const f of fabricIssues) {
    // The stock item behind the roll. postedAt is only stamped where one
    // resolves, because a posted issue without an item is a movement with
    // nothing to move - which is exactly what the CHECK on the table refuses.
    const rollDef = fabricRolls.find((r) => r.rollNo === f.rollNo);
    const issuedItem = rollDef ? itemForRoll(ctx, rollDef) : null;

    const row = await prisma.fabricIssue.create({
      data: {
        issueNo: f.issueNo,
        issueDate: date(f.issueDate),
        vendorId: f.vendorName ? ctx.vendorByName.get(f.vendorName).id : null,
        rollId: ctx.rollByNo.get(f.rollNo).id,
        purpose: f.purpose,
        orderId: ctx.orderByNo.get(f.orderNo).id,
        styleId: ctx.styleByNo.get(f.styleNo).id,
        issuedByEmployeeId: ctx.employeeByName.get(f.issuedByName)?.id ?? null,
        issuedByName: f.issuedByName,
        fabricQtyIssued: dec(f.fabricQtyIssued),
        fabricName: f.fabricName,
        colorCode: f.colorCode,
        uom: 'Mtrs',
        status: f.status,
        remarks: f.remarks,
        location: MAIN_STORE,
        // The seeder writes each issue's ledger OUT itself further down, so
        // these issues ARE out of stock, and are stamped as posted.
        inventoryItemId: issuedItem ? issuedItem.id : null,
        postedAt: issuedItem ? date(f.issueDate) : null,
        postedByName: issuedItem ? 'Seeded from the workbook' : null,
      },
    });
    issueByNo.set(row.issueNo, row);
  }
  log(`fabric issues: ${fabricIssues.length}`);

  const dyeIssueByNo = new Map();
  for (const d of dyeIssues) {
    // Running totals are DERIVED from the returns, here as in the service.
    const issued = dec(d.qty);
    const returned = dyeingReceipts
      .filter((r) => r.dyeIssueNo === d.dyeIssueNo)
      .reduce((sum, r) => sum.plus(dec(r.qtyReceived)), dec(0));
    const shrinkage = returned.isZero() || issued.isZero()
      ? dec(0)
      : issued.minus(returned).div(issued).toDecimalPlaces(6);

    // C3 - the shrinkage tolerance, resolved from shrinkage_rules exactly as
    // jobWork.create() does, and the expected return computed from it. The
    // column no longer carries a default, which is the point: no lot inherits
    // a tolerance nobody chose.
    const jobVendorId = ctx.vendorByName.get(d.vendorName).id;
    const jobShrinkage = await resolveShrinkage(null, {
      process: d.process,
      vendorId: jobVendorId,
      on: date(d.issueDate),
    });

    const row = await prisma.dyeIssue.create({
      data: {
        dyeIssueNo: d.dyeIssueNo,
        issueDate: date(d.issueDate),
        process: d.process,
        shrinkageTolerancePct: jobShrinkage.tolerance,
        shrinkageRuleId: jobShrinkage.ruleId,
        shrinkageRuleBasis: jobShrinkage.basis,
        expectedReturnQty: expectedReturnQty(dec(d.qty), jobShrinkage.tolerance),
        rollId: ctx.rollByNo.get(d.rollNo).id,
        colourCode: d.colourCode,
        content: d.content,
        count: d.count,
        construction: d.construction,
        width: D(d.width),
        gsm: d.gsm,
        vendorId: ctx.vendorByName.get(d.vendorName).id,
        address: d.address,
        pinCode: d.pinCode,
        qty: dec(d.qty),
        uom: d.uom,
        rate: dec(d.rate),
        amount: dec(d.qty).mul(dec(d.rate)).toDecimalPlaces(2),
        remark: d.remark,
        fabricIssueId: d.issueNo ? issueByNo.get(d.issueNo).id : null,
        orderId: d.orderNo ? ctx.orderByNo.get(d.orderNo).id : null,
        // The style is the one on the buyer order the job serves.
        styleId: d.orderNo ? ctx.orderByNo.get(d.orderNo).styleId : null,
        // The workbook routes whole rolls, before stitching, in every
        // sampled row; the Printing sheet is where after-stitching work
        // appears, and it has its own register.
        fabricStage: 'BEFORE_STITCHING',
        receivedQty: returned,
        shrinkagePct: shrinkage,
        status: d.status,
      },
    });
    dyeIssueByNo.set(row.dyeIssueNo, row);
  }
  log(`dye / job-work issues: ${dyeIssues.length}`);

  // Back-fill the gate passes that reference a dye issue by its DY number.
  for (const gp of gatePasses) {
    const di = dyeIssueByNo.get(gp.linkedDocNo);
    if (di) {
      await prisma.gatePass.update({
        where: { gatePassNo: gp.gatePassNo },
        data: { dyeIssueId: di.id },
      });
    }
  }

  for (const r of dyeingReceipts) {
    const qtyIssued = dec(r.qtyIssued);
    const qtyReceived = dec(r.qtyReceived);
    const shrinkagePct = qtyIssued.isZero()
      ? dec(0)
      : qtyIssued.minus(qtyReceived).div(qtyIssued);
    const standard = dec(r.standardShrinkageAllowed);
    await prisma.dyeingReceipt.create({
      data: {
        receiptNo: r.receiptNo,
        receiptDate: date(r.receiptDate),
        dyeIssueId: dyeIssueByNo.get(r.dyeIssueNo).id,
        rollId: ctx.rollByNo.get(r.rollNo).id,
        qtyIssued,
        qtyReceived,
        shrinkagePct,
        standardShrinkageAllowed: standard,
        variationFlag: shrinkagePct.greaterThan(standard),
        // C4 - the scrutiny verdict, taken on the return and recorded there.
        // The two columns are the same decision under two names and a CHECK
        // constraint refuses them if they ever disagree.
        variationPct: shrinkagePct,
        requiresScrutiny: shrinkagePct.greaterThan(standard),
        status: r.status,
        remarks: r.remarks,
      },
    });
  }
  log(`dyeing receipts: ${dyeingReceipts.length}`);

  for (const p of printings) {
    await prisma.printing.create({
      data: {
        printingNo: p.printingNo,
        printingDate: date(p.printingDate),
        orderId: ctx.orderByNo.get(p.orderNo).id,
        styleId: ctx.styleByNo.get(p.styleNo).id,
        vendorId: ctx.vendorByName.get(p.vendorName).id,
        fabricStage: p.fabricStage,
        qty: dec(p.qty),
        uom: p.uom,
        remarks: p.remarks,
        status: p.status,
      },
    });
  }
  log(`printings: ${printings.length}`);

  for (const s of fabricScrutinies) {
    await prisma.fabricScrutiny.create({
      data: {
        scrutinyNo: s.scrutinyNo,
        scrutinyDate: date(s.scrutinyDate),
        rollId: ctx.rollByNo.get(s.rollNo).id,
        orderId: ctx.orderByNo.get(s.orderNo).id,
        styleId: ctx.styleByNo.get(s.styleNo).id,
        defectType: s.defectType,
        qtyAffected: dec(s.qtyAffected),
        uom: 'Mtrs',
        checkedByEmployeeId: ctx.employeeByName.get(s.checkedByName)?.id ?? null,
        checkedByName: s.checkedByName,
        authorisedBy: s.authorisedBy,
        decision: s.decision,
        remarks: s.remarks,
        // Every sampled row carries a decision, so every seeded scrutiny is
        // settled - and a settled scrutiny is locked. Corrections to these
        // go through the amendment path, like any other finalised record.
        decidedAt: date(s.scrutinyDate),
        decidedByName: s.authorisedBy,
        isLocked: true,
        lockedAt: date(s.scrutinyDate),
      },
    });
  }
  log(`fabric scrutinies: ${fabricScrutinies.length}`);

  return { issueByNo, dyeIssueByNo };
}

// ---------------------------------------------------------------------------
//  10. PLAN APPROVAL + CUTTING ISSUE
// ---------------------------------------------------------------------------
async function seedApprovalAndCutting(ctx) {
  const approvalByNo = new Map();
  for (const a of planApprovals) {
    const planning = ctx.planningByOrderNo.get(a.orderNo) ?? null;

    // Version n was raised to replace version n-1 for the same order and
    // container. The sheet leaves that implicit in the round column; the
    // ERP makes it a link, so the chain of attempts can be walked.
    const predecessor =
      a.round > 1
        ? planApprovals.find(
            (p) =>
              p.orderNo === a.orderNo &&
              p.containerNo === a.containerNo &&
              p.round === a.round - 1,
          )
        : null;
    const supersedes = predecessor ? approvalByNo.get(predecessor.approvalNo) : null;

    // Approved versions are immutable, full stop. Rejected ones lock as soon
    // as a successor exists - the work moved on to that successor.
    const decided = a.approvalStatus !== 'PENDING';
    const rectified = planApprovals.some(
      (p) =>
        p.orderNo === a.orderNo &&
        p.containerNo === a.containerNo &&
        p.round === a.round + 1,
    );
    const locked = a.approvalStatus === 'APPROVED' || (decided && rectified);
    const decidedOn = date(a.approvedDate ?? a.submittedDate);
    const row = await prisma.planApproval.create({
      data: {
        approvalNo: a.approvalNo,
        submittedDate: date(a.submittedDate),
        orderId: ctx.orderByNo.get(a.orderNo).id,
        containerNo: a.containerNo,
        preparedBy: a.preparedBy,
        submittedTo: a.submittedTo,
        approvalStatus: a.approvalStatus,
        rejectionReason: a.rejectionReason,
        rectificationRemarks: a.rectificationRemarks,
        approvedDate: date(a.approvedDate),
        planningId: planning ? planning.id : null,
        round: a.round,
        supersedesId: supersedes ? supersedes.id : null,
        decidedAt: decided ? decidedOn : null,
        approvedByName: a.approvalStatus === 'APPROVED' ? a.submittedTo : null,
        rectifiedAt: decided && rectified ? decidedOn : null,
        isLocked: locked,
        lockedAt: locked ? decidedOn : null,
      },
    });
    approvalByNo.set(row.approvalNo, row);
  }
  log(`plan approvals: ${planApprovals.length}`);

  for (const c of cuttingIssues) {
    const planning = ctx.planningByOrderNo.get(c.orderNo) ?? null;
    await prisma.cuttingIssue.create({
      data: {
        challanNo: c.challanNo,
        issueDate: date(c.issueDate),
        orderId: ctx.orderByNo.get(c.orderNo).id,
        styleId: ctx.styleByNo.get(c.styleNo).id,
        plannedCutting: dec(c.plannedCutting),
        firmName: c.firmName,
        unitWiseCuttingPcsToBeIssued: dec(c.unitWiseCuttingPcsToBeIssued),
        cuttingPcsIssued: dec(c.cuttingPcsIssued),
        handleIssued: dec(c.handleIssued),
        containerNo: c.containerNo,
        status: c.status,
        remarks: c.remarks,
        // Cloth was cut and the unit has it: every sampled challan is a
        // posted challan, and a posted challan is locked forever.
        postedAt: c.status === 'CANCELLED' ? null : date(c.issueDate),
        postedByName: c.status === 'CANCELLED' ? null : 'Seeded from the workbook',
        isLocked: c.status !== 'CANCELLED',
        lockedAt: c.status === 'CANCELLED' ? null : date(c.issueDate),
        // Approved by the supervisor who posted it, and then posted. POSTED
        // is the later of the two; the approval trail records both.
        workflowState: c.status === 'CANCELLED' ? 'CANCELLED' : 'POSTED',
        planningId: planning ? planning.id : null,
        planApprovalId: c.approvalNo ? approvalByNo.get(c.approvalNo).id : null,
        fabricIssueId: c.issueNo ? ctx.issueByNo.get(c.issueNo).id : null,
      },
    });
  }
  log(`cutting issues: ${cuttingIssues.length}  <-- final stage of the application`);

  // Link the gate passes that reference a cutting challan.
  for (const gp of gatePasses) {
    const ci = cuttingIssues.find((c) => c.challanNo === gp.linkedDocNo);
    if (ci) {
      const row = await prisma.cuttingIssue.findUnique({ where: { challanNo: ci.challanNo } });
      await prisma.gatePass.update({
        where: { gatePassNo: gp.gatePassNo },
        data: { cuttingIssueId: row.id },
      });
    }
  }

  return { approvalByNo };
}

// ---------------------------------------------------------------------------
//  11. STOCK LEDGER + BALANCES  (derived)
// ---------------------------------------------------------------------------
async function seedStock(ctx) {
  /** @type {{date:string,itemId:string,rollId:string|null,docType:string,docId:string,docNo:string,dir:string,qty:any,rate:any,grnId:string|null,remarks:string|null}[]} */
  const movements = [];

  for (const g of grns) {
    const item = itemForGrn(ctx, g);
    const row = ctx.grnByNo.get(g.grnNo);
    const roll = fabricRolls.find((r) => r.grnNo === g.grnNo);
    const po = purchaseOrders.find((p) => p.poId === g.poId);
    movements.push({
      date: g.grnDate,
      itemId: item.id,
      rollId: roll ? ctx.rollByNo.get(roll.rollNo).id : null,
      docType: 'GRN',
      docId: row.id,
      docNo: row.grnNo,
      dir: 'IN',
      qty: dec(g.receivingQty),
      rate: dec(g.inventoryRate),
      grnId: row.id,
      orderId: po?.orderNo ? ctx.orderByNo.get(po.orderNo)?.id ?? null : null,
      item,
      remarks: `Receipt against PO ${g.poId}, bill ${g.billNo}`,
    });
  }

  for (const f of fabricIssues) {
    const rollDef = fabricRolls.find((r) => r.rollNo === f.rollNo);
    const item = itemForRoll(ctx, rollDef);
    if (!item) continue;
    const row = ctx.issueByNo.get(f.issueNo);
    movements.push({
      date: f.issueDate,
      itemId: item.id,
      rollId: ctx.rollByNo.get(f.rollNo).id,
      docType: 'FABRIC_ISSUE',
      docId: row.id,
      docNo: row.issueNo,
      dir: 'OUT',
      qty: dec(f.fabricQtyIssued),
      rate: D(rollDef.rate) ?? dec(0),
      grnId: null,
      orderId: f.orderNo ? ctx.orderByNo.get(f.orderNo)?.id ?? null : null,
      item,
      remarks: `Issued for ${f.purpose} against ${f.orderNo}`,
    });
  }

  for (const r of dyeingReceipts) {
    const rollDef = fabricRolls.find((x) => x.rollNo === r.rollNo);
    const item = itemForRoll(ctx, rollDef);
    if (!item) continue;
    const row = await prisma.dyeingReceipt.findUnique({ where: { receiptNo: r.receiptNo } });
    movements.push({
      date: r.receiptDate,
      itemId: item.id,
      rollId: ctx.rollByNo.get(r.rollNo).id,
      docType: 'DYEING_RECEIPT',
      docId: row.id,
      docNo: row.receiptNo,
      dir: 'IN',
      qty: dec(r.qtyReceived),
      rate: D(rollDef.rate) ?? dec(0),
      grnId: null,
      orderId: null,
      item,
      remarks: `Returned from ${r.dyeIssueNo}`,
    });
  }

  movements.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const running = new Map();
  for (const m of movements) {
    const key = `${m.itemId}|${MAIN_STORE}`;
    const prev = running.get(key) ?? dec(0);
    const next = m.dir === 'IN' ? prev.plus(m.qty) : prev.minus(m.qty);
    running.set(key, next);
    await prisma.stockLedger.create({
      data: {
        entryDate: date(m.date),
        itemId: m.itemId,
        rollId: m.rollId,
        location: MAIN_STORE,
        // Snapshot of the item as it read on the day, not a join.
        itemCategory: m.item?.itemCategory ?? '',
        colorCode: m.item?.colorCode || null,
        gsm: m.item?.gsm || null,
        content: m.item?.content ?? null,
        uom: m.item?.uom ?? '',
        orderId: m.orderId ?? null,
        documentType: m.docType,
        documentId: m.docId,
        documentNo: m.docNo,
        direction: m.dir,
        qty: m.qty,
        qtyIn: m.dir === 'IN' ? m.qty : dec(0),
        qtyOut: m.dir === 'OUT' ? m.qty : dec(0),
        rate: m.rate,
        value: m.qty.mul(m.rate).toDecimalPlaces(2),
        balanceQty: next,
        grnId: m.grnId,
        createdByName: 'Seeded from the workbook',
        remarks: m.remarks,
      },
    });
  }
  log(`stock ledger entries: ${movements.length}`);

  // The balance is DERIVED, here as everywhere else: summed back out of the
  // ledger rather than carried forward from the loop above. Same arithmetic
  // the application runs in recomputeBalance(), so a seeded database and a
  // live one hold their balances for the same reason.
  let balances = 0;
  for (const key of running.keys()) {
    const [itemId] = key.split('|');
    const [totals, inbound] = await Promise.all([
      prisma.stockLedger.aggregate({
        where: { itemId, location: MAIN_STORE },
        _sum: { qtyIn: true, qtyOut: true },
      }),
      prisma.stockLedger.aggregate({
        where: { itemId, location: MAIN_STORE, direction: 'IN' },
        _sum: { qty: true, value: true },
        _min: { entryDate: true },
      }),
    ]);
    const qty = (totals._sum.qtyIn ?? dec(0)).minus(totals._sum.qtyOut ?? dec(0));
    const inQty = inbound._sum.qty ?? dec(0);
    const inValue = inbound._sum.value ?? dec(0);
    const avgRate = inQty.isZero() ? dec(0) : inValue.div(inQty).toDecimalPlaces(4);
    await prisma.stockBalance.create({
      data: {
        itemId,
        location: MAIN_STORE,
        qty,
        avgRate,
        value: qty.mul(avgRate).toDecimalPlaces(2),
      },
    });
    // FIFO - the seeded stock enters costing the same way a migrated database
    // does: one OPENING layer per (item, location) at the rate above. See
    // migration 20260926000200_fifo_cost_layers.
    if (qty.greaterThan(0)) {
      await prisma.stockCostLayer.create({
        data: {
          itemId,
          location: MAIN_STORE,
          layerDate: inbound._min.entryDate ?? new Date(),
          sourceDocumentNo: 'OPENING',
          qtyIn: qty,
          qtyRemaining: qty,
          rate: avgRate,
          isOpening: true,
        },
      });
    }
    balances += 1;
  }
  log(`stock balances: ${balances}`);
}

// ---------------------------------------------------------------------------
//  12. APPROVAL HISTORY  (derived from the decisions already recorded)
// ---------------------------------------------------------------------------
async function seedApprovalHistory(ctx) {
  const rows = [];

  for (const q of vendorQuotations) {
    if (q.authorisationStatus === 'PENDING') continue;
    const row = ctx.quotationByNo.get(q.quotationNo);
    rows.push({
      documentType: 'VENDOR_QUOTATION',
      documentId: row.id,
      documentNo: row.quotationNo,
      action: q.authorisationStatus === 'APPROVED' ? 'APPROVED' : 'REJECTED',
      fromStatus: 'PENDING',
      toStatus: q.authorisationStatus,
      actedByName: q.authorisedBy,
      actedAt: date(q.quotationDate),
      remarks: q.remarks,
    });
  }

  for (const po of purchaseOrders) {
    if (po.approvalStatus === 'PENDING') continue;
    const row = ctx.poByPoId.get(po.poId);
    rows.push({
      documentType: 'PURCHASE_ORDER',
      documentId: row.id,
      documentNo: row.poId,
      action: 'APPROVED',
      fromStatus: 'PENDING',
      toStatus: po.approvalStatus,
      actedByName: po.approvedByName,
      actedAt: date(po.approvedAt),
      remarks: po.remarks,
    });
  }

  for (const a of planApprovals) {
    const row = ctx.approvalByNo.get(a.approvalNo);
    rows.push({
      documentType: 'PLAN_APPROVAL',
      documentId: row.id,
      documentNo: row.approvalNo,
      sequenceNo: a.round,
      action: 'SUBMITTED',
      fromStatus: null,
      toStatus: 'PENDING',
      actedByName: a.preparedBy,
      actedAt: date(a.submittedDate),
      remarks: a.rectificationRemarks,
    });
    if (a.approvalStatus !== 'PENDING') {
      rows.push({
        documentType: 'PLAN_APPROVAL',
        documentId: row.id,
        documentNo: row.approvalNo,
        sequenceNo: a.round,
        action: a.approvalStatus === 'APPROVED' ? 'APPROVED' : 'REJECTED',
        fromStatus: 'PENDING',
        toStatus: a.approvalStatus,
        actedByName: a.submittedTo,
        actedAt: date(a.approvedDate ?? a.submittedDate),
        remarks: a.rejectionReason,
      });
    }
  }

  for (const s of fabricScrutinies) {
    const row = await prisma.fabricScrutiny.findUnique({ where: { scrutinyNo: s.scrutinyNo } });
    rows.push({
      documentType: 'FABRIC_SCRUTINY',
      documentId: row.id,
      documentNo: row.scrutinyNo,
      action: s.decision === 'REJECT' ? 'REJECTED' : s.decision === 'REWORK' ? 'REWORK_REQUESTED' : 'APPROVED',
      fromStatus: 'PENDING',
      toStatus: s.decision,
      actedByName: s.authorisedBy,
      actedAt: date(s.scrutinyDate),
      remarks: s.remarks,
    });
  }

  await prisma.approvalHistory.createMany({ data: rows });
  log(`approval history entries: ${rows.length}`);
}

// ---------------------------------------------------------------------------
//  12b. EXCESS RULES  (Phase 17 - no percentage is hardcoded any more)
// ---------------------------------------------------------------------------
async function seedExcessRules() {
  await prisma.excessRule.createMany({
    data: excessRules.map((r) => ({
      scope: r.scope,
      scopeKey: r.scopeKey,
      documentType: r.documentType,
      excessPct: dec(r.excessPct),
      hardCeilingPct: D(r.hardCeilingPct),
      requiresApproval: r.requiresApproval,
      basis: r.basis,
      priority: r.priority,
    })),
  });
  log(`excess rules: ${excessRules.length}`);
}

// ---------------------------------------------------------------------------
//  12c. WORKFLOW STATE  (Phase 18 - explicit, and derived from the decisions
//       each module had already recorded)
// ---------------------------------------------------------------------------
async function seedWorkflowStates() {
  // The mapping between each module's own status column and the shared
  // DocumentState. approvalEngine.js owns it from here on; this is the one
  // place the seeded rows are brought into line with it.
  const rules = [
    ['buyerOrder', (r) => (r.status === 'CANCELLED' ? 'CANCELLED'
      : r.excessApprovalStatus === 'APPROVED' || r.excessApprovalStatus === 'NOT_REQUIRED' ? 'APPROVED'
      : r.excessApprovalStatus === 'REJECTED' ? 'REJECTED' : 'PENDING_APPROVAL')],
    ['planning', (r) => (r.approvalStatus === 'APPROVED' ? 'APPROVED'
      : r.approvalStatus === 'REJECTED' ? 'REJECTED'
      : r.submittedAt ? 'PENDING_APPROVAL' : 'DRAFT')],
    ['vendorQuotation', (r) => (r.authorisationStatus === 'APPROVED' ? 'APPROVED'
      : r.authorisationStatus === 'REJECTED' ? 'REJECTED' : 'PENDING_APPROVAL')],
    ['purchaseOrder', (r) => (r.status === 'CANCELLED' ? 'CANCELLED'
      : r.status === 'COMPLETED' && r.approvalStatus === 'APPROVED' ? 'COMPLETED'
      : r.approvalStatus === 'APPROVED' ? 'APPROVED'
      : r.approvalStatus === 'REJECTED' ? 'REJECTED' : 'PENDING_APPROVAL')],
    ['gatePass', (r) => (r.status === 'CLEARED' ? 'APPROVED' : 'SUBMITTED')],
    // A GRN is POSTED, never approved - posting it IS the act, and there is no
    // approval step for anybody to have taken.
    //
    // Fabric issues and job work are absent because neither carries a
    // workflow_state at all: nobody approves them, and their controlled status
    // is `status`, which moves through FULFILMENT_TRANSITIONS instead.
    ['grn', (r) => (r.status === 'CANCELLED' ? 'CANCELLED'
      : r.postedAt ? 'POSTED' : 'DRAFT')],
    ['fabricScrutiny', (r) => (r.isLocked ? 'APPROVED' : 'DRAFT')],
    ['planApproval', (r) => (r.approvalStatus === 'APPROVED' ? 'APPROVED'
      : r.approvalStatus === 'REJECTED' && r.rectifiedAt ? 'RECTIFICATION'
      : r.approvalStatus === 'REJECTED' ? 'REJECTED'
      : r.round > 1 ? 'RESUBMITTED' : 'PENDING_APPROVAL')],
  ];

  let moved = 0;
  for (const [model, stateOf] of rules) {
    const rows = await prisma[model].findMany();
    for (const row of rows) {
      await prisma[model].update({
        where: { id: row.id },
        data: { workflowState: stateOf(row) },
      });
      moved += 1;
    }
  }
  log(`workflow states set: ${moved}`);
}

// ---------------------------------------------------------------------------
//  13. DOCUMENT SEQUENCES
// ---------------------------------------------------------------------------
async function seedSequences() {
  await prisma.documentSequence.createMany({ data: documentSequences });
  log(`document sequences: ${documentSequences.length}`);
}

// ---------------------------------------------------------------------------
//  ROW COUNT REPORT
// ---------------------------------------------------------------------------
const COUNTED = [
  ['master_lists', 'masterList'],
  ['master_list_values', 'masterListValue'],
  ['permissions', 'permission'],
  ['roles', 'role'],
  ['role_permissions', 'rolePermission'],
  ['users', 'user'],
  ['user_roles', 'userRole'],
  ['user_sessions', 'userSession'],
  ['buyers', 'buyer'],
  ['vendors', 'vendor'],
  ['employees', 'employee'],
  ['styles', 'style'],
  ['style_bom_lines', 'styleBomLine'],
  ['buyer_orders', 'buyerOrder'],
  ['plannings', 'planning'],
  ['planning_lines', 'planningLine'],
  ['vendor_quotations', 'vendorQuotation'],
  ['purchase_orders', 'purchaseOrder'],
  ['gate_passes', 'gatePass'],
  ['grns', 'grn'],
  ['fabric_rolls', 'fabricRoll'],
  ['inventory_items', 'inventoryItem'],
  ['stock_balances', 'stockBalance'],
  ['stock_ledger', 'stockLedger'],
  ['fabric_issues', 'fabricIssue'],
  ['dye_issues', 'dyeIssue'],
  ['dyeing_receipts', 'dyeingReceipt'],
  ['printings', 'printing'],
  ['fabric_scrutinies', 'fabricScrutiny'],
  ['plan_approvals', 'planApproval'],
  ['cutting_issues', 'cuttingIssue'],
  ['approval_history', 'approvalHistory'],
  ['document_amendments', 'documentAmendment'],
  ['audit_logs', 'auditLog'],
  ['document_sequences', 'documentSequence'],
];

async function printRowCounts() {
  const width = Math.max(...COUNTED.map(([t]) => t.length));
  let total = 0;
  process.stdout.write('\n=== ROW COUNTS ===\n');
  for (const [table, model] of COUNTED) {
    const n = await prisma[model].count();
    total += n;
    process.stdout.write(`  ${table.padEnd(width)}  ${String(n).padStart(6)}\n`);
  }
  process.stdout.write(`  ${'-'.repeat(width)}  ${'-'.repeat(6)}\n`);
  process.stdout.write(`  ${'TOTAL'.padEnd(width)}  ${String(total).padStart(6)}\n\n`);
}

// ---------------------------------------------------------------------------
//  MAIN
// ---------------------------------------------------------------------------
async function main() {
  process.stdout.write('\nSeeding Shekhawati Impex ERP...\n\n');

  await wipe();
  await seedMasterLists();
  await seedRbac();

  const masterCtx = await seedMasters();
  await seedUsers(masterCtx.employeeByEmpId);

  // A live deployment starts with users, masters and configuration only - no
  // sample orders, purchases or stock.
  if (process.env.SEED_ESSENTIALS_ONLY === 'true') {
    await seedExcessRules();
    await seedWorkflowStates();
    await seedSequences();
    await printRowCounts();
    process.stdout.write('Seed complete (essentials only).\n\n');
    return;
  }

  const orderCtx = await seedOrdersAndPlanning(masterCtx);
  const ctx1 = { ...masterCtx, ...orderCtx };

  const procCtx = await seedProcurement(ctx1);
  const ctx2 = { ...ctx1, ...procCtx };

  const gpCtx = await seedGatePasses(ctx2);
  const ctx3 = { ...ctx2, ...gpCtx };

  const grnCtx = await seedGrns(ctx3);
  const ctx4 = { ...ctx3, ...grnCtx };

  const invCtx = await seedInventoryItems(ctx4);
  const ctx5 = { ...ctx4, ...invCtx };
  await stampGrnPostings(ctx5);

  const rollCtx = await seedFabricRolls(ctx5);
  const ctx6 = { ...ctx5, ...rollCtx };

  const prodCtx = await seedProduction(ctx6);
  const ctx7 = { ...ctx6, ...prodCtx };

  const cutCtx = await seedApprovalAndCutting(ctx7);
  const ctx8 = { ...ctx7, ...cutCtx };

  await seedStock(ctx8);
  await seedApprovalHistory(ctx8);
  await seedExcessRules();
  await seedWorkflowStates();
  await seedSequences();

  await printRowCounts();
  process.stdout.write('Seed complete.\n\n');
}

main()
  .catch((e) => {
    process.stderr.write(`\nSEED FAILED: ${e.stack ?? e}\n\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
