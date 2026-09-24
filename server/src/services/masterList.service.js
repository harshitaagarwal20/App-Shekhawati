/**
 * List Master - the "Master Lists" sheet.
 *
 * This is the single source for every business dropdown in the application.
 * The workbook rule is: add a value at the bottom of a column and every
 * dropdown picks it up. The React client therefore holds NO hardcoded business
 * dropdown values; it reads them from here by list code.
 */

import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { searchFilter } from '../utils/http.js';

export const SORTABLE = ['code', 'name', 'createdAt'];
export const VALUE_SORTABLE = ['value', 'sortOrder', 'createdAt'];

function projectList(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    isSystem: row.isSystem,
    valueCount: row._count?.values ?? undefined,
    values: row.values?.map(projectValue),
  };
}

function projectValue(row) {
  return {
    id: row.id,
    listId: row.listId,
    value: row.value,
    code: row.code,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    attributes: row.attributes,
  };
}

// --- Lists -----------------------------------------------------------------

export async function listLists({ page, pageSize, skip, take, orderBy, search, includeDeleted }) {
  const where = {
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...searchFilter(search, ['code', 'name', 'description']),
  };
  const [rows, total] = await Promise.all([
    prisma.masterList.findMany({
      where,
      orderBy,
      skip,
      take,
      include: { _count: { select: { values: { where: { deletedAt: null } } } } },
    }),
    prisma.masterList.count({ where }),
  ]);
  return { rows: rows.map(projectList), total, page, pageSize };
}

/**
 * Every dropdown VALUE in the application, one row per value, with the list it
 * belongs to beside it.
 *
 * ---------------------------------------------------------------------------
 *  WHY THIS IS FLAT AND `listLists` IS NOT
 *
 *  `listLists` answers "what lists are there", which is the Master Lists
 *  screen. This answers "what values are there", which is the sheet somebody
 *  means when they ask for the master lists as a file: the values ARE the
 *  data, and the list code is the heading they sit under. Nested inside their
 *  lists they cannot be exported to one CSV, sorted in Excel, or sent back
 *  through the importer - and sending them back is the point. One row per
 *  value is the only shape all three of those work on.
 *
 *  The search covers the list as well as the value, so "UOM" finds every unit
 *  and "Mtrs" finds the one.
 * ---------------------------------------------------------------------------
 */
export async function listAllValues({ page, pageSize, skip, take, search, includeDeleted, listCode } = {}) {
  const where = {
    ...(includeDeleted ? {} : { deletedAt: null }),
    list: { deletedAt: null, ...(listCode ? { code: listCode } : {}) },
    ...(search
      ? {
          OR: [
            { value: { contains: search, mode: 'insensitive' } },
            { code: { contains: search, mode: 'insensitive' } },
            { list: { code: { contains: search, mode: 'insensitive' } } },
            { list: { name: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.masterListValue.findMany({
      where,
      // Grouped by list, then in the order the dropdown itself shows them, so
      // the file reads the way the screens do.
      orderBy: [{ list: { code: 'asc' } }, { sortOrder: 'asc' }, { value: 'asc' }],
      skip,
      take,
      include: { list: { select: { code: true, name: true } } },
    }),
    prisma.masterListValue.count({ where }),
  ]);

  return {
    rows: rows.map((row) => ({
      ...projectValue(row),
      listCode: row.list.code,
      listName: row.list.name,
    })),
    total,
    page,
    pageSize,
  };
}

export async function getList(id) {
  const row = await prisma.masterList.findFirst({
    where: { id, deletedAt: null },
    include: {
      values: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { value: 'asc' }] },
    },
  });
  if (!row) throw ApiError.notFound('Master list');
  return projectList(row);
}

/**
 * The dropdown endpoint. Returns active values for one list code.
 *
 * `?includeInactive=true` is used by edit forms so that a document created
 * against a value that has since been deactivated still shows that value
 * instead of rendering an empty select.
 */
export async function getValuesByCode(code, { includeInactive = false } = {}) {
  const list = await prisma.masterList.findFirst({
    where: { code, deletedAt: null },
    include: {
      values: {
        where: { deletedAt: null, ...(includeInactive ? {} : { isActive: true }) },
        orderBy: [{ sortOrder: 'asc' }, { value: 'asc' }],
      },
    },
  });
  if (!list) throw ApiError.notFound(`Master list "${code}"`);
  return { code: list.code, name: list.name, values: list.values.map(projectValue) };
}

/** Several lists in one round trip, so a form loads its dropdowns at once. */
export async function getManyByCode(codes, { includeInactive = false } = {}) {
  const lists = await prisma.masterList.findMany({
    where: { code: { in: codes }, deletedAt: null },
    include: {
      values: {
        where: { deletedAt: null, ...(includeInactive ? {} : { isActive: true }) },
        orderBy: [{ sortOrder: 'asc' }, { value: 'asc' }],
      },
    },
  });
  const out = {};
  for (const list of lists) out[list.code] = list.values.map(projectValue);
  for (const code of codes) if (!out[code]) out[code] = [];
  return out;
}

export async function createList(input, actorId) {
  const clash = await prisma.masterList.findUnique({ where: { code: input.code } });
  if (clash) throw ApiError.conflict('A list with this code already exists', { field: 'code' });

  const row = await prisma.masterList.create({
    data: {
      code: input.code,
      name: input.name,
      description: input.description,
      isSystem: false,
      createdById: actorId,
      updatedById: actorId,
    },
    include: { values: true },
  });
  return projectList(row);
}

export async function updateList(id, input, actorId) {
  const list = await prisma.masterList.findFirst({ where: { id, deletedAt: null } });
  if (!list) throw ApiError.notFound('Master list');
  if (list.isSystem && input.code && input.code !== list.code) {
    throw ApiError.badRequest('The code of a system list cannot be changed - forms depend on it');
  }

  const row = await prisma.masterList.update({
    where: { id },
    data: {
      ...(input.code !== undefined && !list.isSystem ? { code: input.code } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      updatedById: actorId,
    },
    include: {
      values: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { value: 'asc' }] },
    },
  });
  return projectList(row);
}

export async function removeList(id, actorId) {
  const list = await prisma.masterList.findFirst({ where: { id, deletedAt: null } });
  if (!list) throw ApiError.notFound('Master list');
  if (list.isSystem) {
    throw ApiError.badRequest('System lists cannot be deleted. Deactivate individual values instead.');
  }
  await prisma.masterList.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: actorId },
  });
  return { deleted: true };
}

// --- Values ----------------------------------------------------------------

export async function addValue(listId, input, actorId) {
  const list = await prisma.masterList.findFirst({ where: { id: listId, deletedAt: null } });
  if (!list) throw ApiError.notFound('Master list');

  const existing = await prisma.masterListValue.findFirst({
    where: { listId, value: input.value },
  });
  if (existing) {
    if (existing.deletedAt) {
      // Re-adding a value that was removed: bring the original row back so
      // documents that reference the text stay consistent.
      const restored = await prisma.masterListValue.update({
        where: { id: existing.id },
        data: {
          deletedAt: null,
          deletedById: null,
          isActive: true,
          sortOrder: input.sortOrder ?? existing.sortOrder,
          updatedById: actorId,
        },
      });
      return projectValue(restored);
    }
    throw ApiError.conflict('This value already exists in the list', { field: 'value' });
  }

  const last = await prisma.masterListValue.findFirst({
    where: { listId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });

  const row = await prisma.masterListValue.create({
    data: {
      listId,
      value: input.value,
      code: input.code ?? input.value,
      sortOrder: input.sortOrder ?? (last ? last.sortOrder + 10 : 10),
      isActive: input.isActive ?? true,
      attributes: input.attributes ?? undefined,
      createdById: actorId,
      updatedById: actorId,
    },
  });
  return projectValue(row);
}

export async function updateValue(valueId, input, actorId) {
  const value = await prisma.masterListValue.findFirst({ where: { id: valueId, deletedAt: null } });
  if (!value) throw ApiError.notFound('List value');

  if (input.value && input.value !== value.value) {
    const clash = await prisma.masterListValue.findFirst({
      where: { listId: value.listId, value: input.value, id: { not: valueId } },
    });
    if (clash) throw ApiError.conflict('This value already exists in the list', { field: 'value' });
  }

  const row = await prisma.masterListValue.update({
    where: { id: valueId },
    data: {
      ...(input.value !== undefined ? { value: input.value } : {}),
      ...(input.code !== undefined ? { code: input.code } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.attributes !== undefined ? { attributes: input.attributes } : {}),
      updatedById: actorId,
    },
  });
  return projectValue(row);
}

/**
 * Active/inactive control for a single dropdown value. Deactivating hides it
 * from new documents; documents already carrying the text are untouched.
 */
export async function setValueActive(valueId, isActive, actorId) {
  return updateValue(valueId, { isActive }, actorId);
}

export async function removeValue(valueId, actorId) {
  const value = await prisma.masterListValue.findFirst({ where: { id: valueId, deletedAt: null } });
  if (!value) throw ApiError.notFound('List value');

  await prisma.masterListValue.update({
    where: { id: valueId },
    data: { deletedAt: new Date(), deletedById: actorId, isActive: false },
  });
  return { deleted: true };
}

/**
 * How many valid values a refusal will name before it stops listing them.
 *
 * Long enough for every business list in the system to be named in full - the
 * largest is under thirty - and short enough that a list somebody has grown to
 * hundreds does not turn one error into a wall of text. Past the limit the
 * message says where to see the rest.
 */
const VALUES_IN_ERROR = 30;

/**
 * Validates that a value belongs to a list. Used by every transaction service
 * from Phase 3 onward, and by the master services below.
 *
 * ---------------------------------------------------------------------------
 *  A REFUSAL NAMES WHAT IS ALLOWED, NOT ONLY WHAT WAS WRONG
 *
 *  This used to say:
 *
 *      "10 oz Fabric" is not an active value of the FabricContent list
 *
 *  Both halves of which are a dead end for the person reading it. They know
 *  what they typed; what they need is what they SHOULD have typed - and
 *  `FabricContent` is a code that appears nowhere they can see, because the
 *  screen calls that list "Fabric Content" and the sidebar calls the screen
 *  Dropdown Lists. So the message named a place they could not find and
 *  withheld the answer they needed. On a 470-row import it did that 470 times.
 *
 *  It now says:
 *
 *      "10 oz Fabric" is not one of the Fabric Content values. Valid values
 *      are: 100% Cotton, 100% Jute, Cotton-Poly 80:20, Recycled Cotton,
 *      Canvas Cotton.
 *
 *  The extra query costs one indexed read on a list of tens of rows, and only
 *  on the path that was about to fail anyway. Nothing pays for it on success.
 *
 *  The list's own NAME is used where it has one ("Fabric Content"), falling
 *  back to the code if it does not. `details.list` still carries the code, so
 *  anything reading this error programmatically is unaffected.
 * ---------------------------------------------------------------------------
 */
export async function assertValueInList(
  listCode,
  value,
  { field = 'value', required = false, allow = null } = {},
) {
  if (value === null || value === undefined || value === '') {
    if (required) throw ApiError.badRequest(`${field} is required`);
    return;
  }

  /*
   * GRANDFATHERING: a value the ROW ALREADY HOLDS.
   *
   * A list value can be withdrawn - L_ItemCategory lost Handle, Zipper, Label,
   * Button and Thread when trim became "Accessories plus an item". Rows saved
   * before that still carry the old word, and the screens still render it on
   * purpose (see the note in pages/masters/Styles.jsx).
   *
   * Without this, those rows became read-only by accident: a document that
   * revalidates its whole child collection on save - as the Style BOM does,
   * because it is replaced wholesale - would refuse a row the user never
   * touched, naming a value the screen itself had just shown them.
   *
   * `allow` is never a caller's guess at what ought to be permitted. It is the
   * set of values read back from the stored row, so a withdrawn value can be
   * KEPT but never newly CHOSEN.
   */
  if (allow && (allow instanceof Set ? allow.has(value) : allow.includes(value))) return;
  const hit = await prisma.masterListValue.findFirst({
    where: {
      value,
      isActive: true,
      deletedAt: null,
      list: { code: listCode, deletedAt: null },
    },
    select: { id: true },
  });
  if (hit) return;

  const list = await prisma.masterList.findFirst({
    where: { code: listCode, deletedAt: null },
    select: {
      name: true,
      values: {
        where: { isActive: true, deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { value: 'asc' }],
        take: VALUES_IN_ERROR + 1,
        select: { value: true },
      },
    },
  });

  const listName = list?.name ?? listCode;

  /*
   * A list that does not exist is a different mistake from a value that is not
   * in one, and saying "valid values are: (none)" would send the reader hunting
   * for a value nobody can add. Name the missing list instead.
   */
  if (!list) {
    throw ApiError.badRequest(
      `The ${listCode} list does not exist, so "${value}" cannot be checked against it.`,
      { field, list: listCode },
    );
  }

  const values = list.values.map((v) => v.value);
  const shown = values.slice(0, VALUES_IN_ERROR);
  const allowed = shown.length === 0
    ? `The ${listName} list has no active values yet - add one on the Dropdown Lists screen.`
    : `Valid values are: ${shown.join(', ')}${values.length > shown.length ? ', and more - see the Dropdown Lists screen' : ''}.`;

  throw ApiError.badRequest(
    `"${value}" is not one of the ${listName} values. ${allowed}`,
    { field, list: listCode, listName, validValues: shown },
  );
}
