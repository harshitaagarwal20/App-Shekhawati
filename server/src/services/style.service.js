/**
 * Style Master (BOM). Sheet: "Style Master (BOM)".
 *
 * The sheet carries the style header and its average fabric utilisation per
 * piece; the BOM lines are the material breakdown Procurement needs in order to
 * raise an "Order as per Style" purchase order.
 *
 * Rule kept from the sheet: the Fabric BOM line's qtyPerPc is the same number
 * as the header's "Avg Fabric Utilization / Pc". Editing either keeps the other
 * in step, so the two can never disagree.
 */

import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { blockIfReferenced, makeCrud } from './crud.js';
import { assertAccessoryVariety, assertValueInList } from './masterList.service.js';
import { OPTIONS_LIMIT } from '../utils/http.js';
import { requirementFor as resolveRequirement } from '../domain/requirement.js';
import { computeRequirement } from '../domain/requirement.js';
import { perBag } from '../domain/panels.js';

export const SORTABLE = ['styleNo', 'styleDescription', 'category', 'status', 'createdAt'];
const SEARCH = ['styleNo', 'styleDescription', 'category', 'fabricContent', 'colorCode', 'sizeGroup'];

const INCLUDE = {
  buyer: { select: { id: true, buyerCode: true, buyerName: true } },
  bomLines: { where: { deletedAt: null }, orderBy: { lineNo: 'asc' } },
  components: { orderBy: { lineNo: 'asc' } },
};

const LIST_INCLUDE = {
  buyer: { select: { id: true, buyerCode: true, buyerName: true } },
  _count: { select: { bomLines: { where: { deletedAt: null } } } },
};

/**
 * C9 - `qtyPerPc` is a DEPRECATED READ ALIAS, as well as a write alias.
 *
 * The column was renamed to `avg_utilisation_per_piece`, and the input schema
 * was given an alias so nothing posting to this server broke. That was only
 * half the promise: a caller that WRITES `qtyPerPc` and then READS the response
 * back got `undefined`, silently, and any arithmetic on it became NaN. The
 * existing API tests caught exactly that.
 *
 * Both names are now returned, carrying the same value. The alias is
 * deprecated, not supported for ever - but a rename that breaks readers is a
 * breaking change whatever the changelog says, and this one did not need to be.
 */
function projectBomLine(line) {
  return { ...line, qtyPerPc: line.avgUtilisationPerPiece };
}

function project(row) {
  return {
    ...row,
    ...(row.bomLines ? { bomLines: row.bomLines.map(projectBomLine) } : {}),
    // What one bag is cut into, so no screen has to add the panel list up.
    ...(row.components ? { panelsPerBag: perBag(row.components) } : {}),
    bomLineCount: row._count?.bomLines,
    _count: undefined,
  };
}

async function validateHeader(data) {
  if (data.category !== undefined) {
    await assertValueInList('StyleCategory', data.category, { field: 'category', required: true });
  }
  if (data.fabricContent !== undefined) {
    await assertValueInList('FabricContent', data.fabricContent, { field: 'fabricContent' });
  }
  if (data.colorCode !== undefined) {
    await assertValueInList('ColorCode', data.colorCode, { field: 'colorCode' });
  }
  if (data.sizeGroup !== undefined) {
    await assertValueInList('SizeGroup', data.sizeGroup, { field: 'sizeGroup' });
  }
  if (data.closure !== undefined) {
    await assertValueInList('Closure', data.closure, { field: 'closure' });
  }
  if (data.lining !== undefined) {
    await assertValueInList('Lining', data.lining, { field: 'lining' });
  }
  if (data.avgUtilizationUom !== undefined) {
    await assertValueInList('UOM', data.avgUtilizationUom, { field: 'avgUtilizationUom' });
  }
  if (data.buyerId !== undefined) {
    const buyer = await prisma.buyer.findFirst({ where: { id: data.buyerId, deletedAt: null } });
    if (!buyer) throw ApiError.badRequest('Buyer does not exist', { field: 'buyerId' });
  }
}

/**
 * @param {Set<string>|null} keepCategories  Item categories this style's BOM
 *   ALREADY holds. A withdrawn category stays editable on the row that carries
 *   it; it cannot be chosen for a new one. Null on create - a new style uses
 *   the list as it stands today.
 */
async function validateBomLine(line, index, keepCategories = null, keepVarieties = null) {
  const at = `bom[${index}]`;
  await assertValueInList('ItemCategory', line.itemCategory, {
    field: `${at}.itemCategory`,
    required: true,
    allow: keepCategories,
  });
  await assertValueInList('UOM', line.uom, { field: `${at}.uom`, required: true });
  if (line.subCategory) await assertValueInList('FabricSubCat', line.subCategory, { field: `${at}.subCategory` });
  if (line.accessoriesItem) await assertValueInList('AccessoriesItem', line.accessoriesItem, { field: `${at}.accessoriesItem` });
  await assertAccessoryVariety(line.accessoriesItem, line.accessoryType, {
    field: `${at}.accessoryType`,
    allow: keepVarieties,
  });
  if (line.colorCode) await assertValueInList('ColorCode', line.colorCode, { field: `${at}.colorCode` });
  if (line.content) await assertValueInList('FabricContent', line.content, { field: `${at}.content` });
  if (line.gsm) await assertValueInList('GSM', line.gsm, { field: `${at}.gsm` });
  if (line.count) await assertValueInList('Count', line.count, { field: `${at}.count` });
  if (line.construction) await assertValueInList('Construction', line.construction, { field: `${at}.construction` });
}

const crud = makeCrud({
  model: 'style',
  label: 'Style',
  searchFields: SEARCH,
  sortable: SORTABLE,
  defaultSort: 'styleNo',
  include: INCLUDE,
  listInclude: LIST_INCLUDE,
  project,
  extraFilters: (where, query) => ({
    ...where,
    ...(query.buyerId ? { buyerId: query.buyerId } : {}),
    ...(query.category ? { category: query.category } : {}),
  }),
  assertDeletable: blockIfReferenced('Style', [
    { model: 'buyerOrder', field: 'styleId', what: 'buyer order(s)' },
    { model: 'fabricIssue', field: 'styleId', what: 'fabric issue(s)' },
    { model: 'cuttingIssue', field: 'styleId', what: 'cutting issue(s)' },
  ]),
});

/*
 * The dropdown check, reachable from outside.
 *
 * Master List membership is checked HERE rather than in the zod schema, on
 * purpose: list content is data, not code, and a value added this morning must
 * be accepted this afternoon without a redeploy. The consequence is that a
 * schema alone cannot tell whether a row is importable - so the bulk importer
 * calls this same function during its check pass, and a file with a mistyped
 * category is refused before anything is written rather than failing halfway
 * through. See services/import.service.js.
 */
export { validateHeader as assertDropdowns };

export const list = crud.list;
export const getById = crud.getById;
export const setStatus = crud.setStatus;
export const remove = crud.remove;
export const restore = crud.restore;

/** Keeps the Fabric BOM line and the header average in step. */
function syncFabricLine(bom, avgUtilization) {
  if (!bom?.length || avgUtilization === undefined) return bom;
  const fabricIndex = bom.findIndex((l) => l.itemCategory === 'Fabric');
  if (fabricIndex === -1) return bom;
  const copy = [...bom];
  copy[fabricIndex] = {
    ...copy[fabricIndex],
    avgUtilisationPerPiece: String(avgUtilization),
  };
  return copy;
}

export async function create(input, actorId) {
  await validateHeader(input);

  const clash = await prisma.style.findUnique({
    where: { styleNo: input.styleNo },
    select: { id: true },
  });
  if (clash) throw ApiError.conflict('This style number already exists', { field: 'styleNo' });

  const bom = syncFabricLine(input.bom ?? [], input.avgFabricUtilizationPerPc);
  for (const [i, line] of bom.entries()) await validateBomLine(line, i);

  const row = await prisma.style.create({
    data: {
      styleNo: input.styleNo,
      styleDescription: input.styleDescription,
      buyerId: input.buyerId,
      category: input.category ?? '',
      fabricContent: input.fabricContent ?? null,
      colorCode: input.colorCode ?? null,
      avgFabricUtilizationPerPc: input.avgFabricUtilizationPerPc,
      avgUtilizationUom: input.avgUtilizationUom ?? 'Mtrs',
      sizeGroup: input.sizeGroup ?? null,
      qtyPerCarton: input.qtyPerCarton ?? null,
      ...specFields(input),
      imageRef: input.imageRef ?? null,
      status: input.status ?? 'ACTIVE',
      remarks: input.remarks ?? null,
      createdById: actorId,
      updatedById: actorId,
      bomLines: {
        create: bom.map((line, i) => ({ ...line, lineNo: i + 1, createdById: actorId, updatedById: actorId })),
      },
      components: {
        create: componentRows(input.components ?? [], bom.length, actorId),
      },
    },
    include: INCLUDE,
  });
  return project(row);
}

export async function update(id, input, actorId) {
  const style = await prisma.style.findFirst({ where: { id, deletedAt: null } });
  if (!style) throw ApiError.notFound('Style');

  await validateHeader(input);

  if (input.styleNo && input.styleNo !== style.styleNo) {
    const clash = await prisma.style.findFirst({
      where: { styleNo: input.styleNo, id: { not: id } },
      select: { id: true },
    });
    if (clash) throw ApiError.conflict('This style number already exists', { field: 'styleNo' });
  }

  const { bom, components, ...header } = input;

  // If the header average changed but the BOM was not resubmitted, push the
  // new average onto the existing Fabric line so the two stay consistent.
  if (bom === undefined && header.avgFabricUtilizationPerPc !== undefined) {
    await prisma.styleBomLine.updateMany({
      where: { styleId: id, itemCategory: 'Fabric', deletedAt: null },
      data: {
        avgUtilisationPerPiece: header.avgFabricUtilizationPerPc,
        updatedById: actorId,
      },
    });
  }

  if (bom !== undefined) {
    const synced = syncFabricLine(bom, header.avgFabricUtilizationPerPc ?? style.avgFabricUtilizationPerPc);

    /*
     * The categories this BOM already carries, so a line saved under a value
     * that has since been withdrawn from L_ItemCategory survives an edit to
     * some other row. The BOM is replaced wholesale, so every line is
     * revalidated on every save - which is what made a withdrawn value fatal
     * rather than merely historical.
     */
    const existing = await prisma.styleBomLine.findMany({
      where: { styleId: id, deletedAt: null },
      select: { itemCategory: true, accessoryType: true },
    });
    const keepCategories = new Set(existing.map((l) => l.itemCategory).filter(Boolean));
    const keepVarieties = new Set(existing.map((l) => l.accessoryType).filter(Boolean));

    for (const [i, line] of synced.entries()) {
      await validateBomLine(line, i, keepCategories, keepVarieties);
    }

    await prisma.$transaction([
      // Replace the BOM wholesale: hard-delete lines rather than soft-delete,
      // because a BOM line is a component of the style, not a document of
      // its own, and no transaction references a line id.
      prisma.styleBomLine.deleteMany({ where: { styleId: id } }),
      prisma.styleBomLine.createMany({
        data: synced.map((line, i) => ({
          ...line,
          styleId: id,
          lineNo: i + 1,
          createdById: actorId,
          updatedById: actorId,
        })),
      }),
    ]);
  }

  if (components !== undefined) {
    const bomCount = bom !== undefined
      ? bom.length
      : await prisma.styleBomLine.count({ where: { styleId: id, deletedAt: null } });
    const rows = componentRows(components, bomCount, actorId);
    // Replaced wholesale, like the BOM: a panel is a part of the style, not a
    // document, and the receipts that multiplied by it froze their own copy.
    await prisma.$transaction([
      prisma.styleComponent.deleteMany({ where: { styleId: id } }),
      prisma.styleComponent.createMany({ data: rows.map((r) => ({ ...r, styleId: id })) }),
    ]);
  }

  const row = await prisma.style.update({
    where: { id },
    data: { ...header, updatedById: actorId },
    include: INCLUDE,
  });
  return project(row);
}

/**
 * The tech-pack columns, as the create path writes them. Update spreads the
 * header straight through, so only create needs the defaults spelled out.
 */
function specFields(input) {
  return {
    bagLength: input.bagLength ?? null,
    bagWidth: input.bagWidth ?? null,
    bagHeight: input.bagHeight ?? null,
    gussetWidth: input.gussetWidth ?? null,
    handleDrop: input.handleDrop ?? null,
    strapLength: input.strapLength ?? null,
    dimensionUom: input.dimensionUom ?? 'cm',
    closure: input.closure ?? null,
    lining: input.lining ?? null,
    printPlacement: input.printPlacement ?? null,
    artworkVersion: input.artworkVersion ?? null,
  };
}

/**
 * The panel list as rows, numbered in the order given.
 *
 * A panel naming a BOM line that does not exist is refused here rather than
 * stored: "cut from line 4" on a three-line BOM is a panel nobody can cut.
 */
function componentRows(components, bomLineCount, actorId) {
  return components.map((c, i) => {
    if (c.bomLineNo != null && (c.bomLineNo < 1 || c.bomLineNo > bomLineCount)) {
      throw ApiError.badRequest(
        `Panel ${i + 1} (${c.name}) is cut from BOM line ${c.bomLineNo}, but the BOM has ` +
          `${bomLineCount} line(s).`,
        { field: `components[${i}].bomLineNo` },
      );
    }
    return {
      lineNo: i + 1,
      componentType: c.componentType,
      name: c.name,
      piecesPerBag: c.piecesPerBag,
      cutLength: c.cutLength ?? null,
      cutWidth: c.cutWidth ?? null,
      bomLineNo: c.bomLineNo ?? null,
      remarks: c.remarks ?? null,
      createdById: actorId,
      updatedById: actorId,
    };
  });
}

/** Style dropdown for Order / Fabric Issue / Cutting Issue screens. */
export async function options({ buyerId } = {}) {
  return prisma.style.findMany({
    where: { deletedAt: null, status: 'ACTIVE', ...(buyerId ? { buyerId } : {}) },
    orderBy: { styleNo: 'asc' },
    take: OPTIONS_LIMIT,
    select: {
      id: true,
      styleNo: true,
      styleDescription: true,
      category: true,
      fabricContent: true,
      colorCode: true,
      sizeGroup: true,
      avgFabricUtilizationPerPc: true,
      avgUtilizationUom: true,
      buyerId: true,
      buyer: { select: { id: true, buyerName: true } },
    },
  });
}

/**
 * Material requirement for a quantity of a style - the "Order as per Style"
 * calculation from Process Documentation s.5. Exposed now because the Style BOM
 * screen shows it; the PO module consumes it in a later phase.
 */
export async function requirementFor(styleId, qty) {
  const style = await prisma.style.findFirst({
    where: { id: styleId, deletedAt: null },
    include: INCLUDE,
  });
  if (!style) throw ApiError.notFound('Style');

  const pieces = Number(qty);
  if (!Number.isFinite(pieces) || pieces <= 0) {
    throw ApiError.badRequest('Quantity must be a positive number');
  }

  /*
   * THE FABRIC LINE EXISTS EVEN WHEN THE BOM DOES NOT.
   *
   * A style's cloth is described by "Avg Fabric Utilization / Pc" on the Style
   * Master - the number the office negotiates and the buyer's measurement
   * sheet carries. A fabric BOM line is optional beside it and only adds the
   * wastage percentage.
   *
   * This explosion used to map `bomLines` alone, so a style with a utilisation
   * and no BOM rows - which is most of them - returned NO LINES AT ALL. The
   * cutting challan then had nothing to prefill and said nothing about why,
   * and the Style BOM screen showed a style that consumes nothing.
   *
   * `domain/requirement.js` already resolves this properly: its Fabric branch
   * reads the header and picks up a fabric line's wastage where one exists.
   * Calling it here makes this endpoint agree with Planning and the PO ceiling
   * instead of disagreeing with them whenever the BOM is thin.
   */
  const hasFabricLine = style.bomLines.some((l) => l.itemCategory === 'Fabric');
  const fromHeader = hasFabricLine
    ? null
    : resolveRequirement({
        style,
        order: { effectiveQty: pieces },
        line: { itemCategory: 'Fabric' },
      });

  const headerFabric = fromHeader?.requirement
    ? [{
        lineNo: 0,
        itemCategory: 'Fabric',
        subCategory: null,
        accessoriesItem: null,
        description: style.styleDescription ?? null,
        colorCode: style.colorCode ?? null,
        uom: fromHeader.uom,
        avgUtilisationPerPiece: Number(fromHeader.perPiece),
        qtyPerPc: Number(fromHeader.perPiece),
        effectiveFrom: null,
        wastagePct: Number(fromHeader.wastagePct),
        baseRequirement: Number(fromHeader.requirement),
        withWastage: Number(fromHeader.requirement),
        /** Says where it came from, since it is not a row of the BOM. */
        source: 'STYLE_HEADER',
        basis: fromHeader.basis,
      }]
    : [];

  return {
    styleNo: style.styleNo,
    orderQty: pieces,
    /** Why there is nothing to explode, when there is nothing. */
    noRequirementReason:
      style.bomLines.length === 0 && !headerFabric.length
        ? (fromHeader?.basis
           ?? `Style ${style.styleNo} has no bill of materials and no average fabric `
              + 'utilisation, so nothing describes what one piece consumes.')
        : null,
    lines: [...headerFabric, ...style.bomLines.map((line) => {
      // C9: the SHARED requirement calculation, so this explode-the-BOM
       // helper agrees with Planning, the PO ceiling and the Cutting Challan
       // by construction rather than by three people keeping four copies of
       // one multiplication in step.
      const per = Number(line.avgUtilisationPerPiece);
      const wastage = Number(line.wastagePct);
      const base = computeRequirement(line.avgUtilisationPerPiece, pieces);
      const withWastage = computeRequirement(line.avgUtilisationPerPiece, pieces, line.wastagePct);
      return {
        lineNo: line.lineNo,
        itemCategory: line.itemCategory,
        subCategory: line.subCategory,
        accessoriesItem: line.accessoriesItem,
        accessoryType: line.accessoryType,
        description: line.description,
        /* The BOM line's own colour, so a document built from this explosion
           does not have to be told again what the style already says. */
        colorCode: line.colorCode,
        uom: line.uom,
        /** C9's name for it. `qtyPerPc` is kept as a deprecated alias. */
        avgUtilisationPerPiece: per,
        qtyPerPc: per,
        effectiveFrom: line.effectiveFrom,
        wastagePct: wastage,
        baseRequirement: Number(base.toFixed(4)),
        withWastage: Number(withWastage.toFixed(4)),
      };
    })],
  };
}
