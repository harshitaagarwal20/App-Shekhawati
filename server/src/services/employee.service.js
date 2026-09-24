/**
 * Employee Master. Sheet: "Employee Master" (Role Acess - Admin).
 */

import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { blockIfReferenced, makeCrud } from './crud.js';
import { assertValueInList } from './masterList.service.js';
import { nextNumber } from './documentNumber.service.js';
import { OPTIONS_LIMIT } from '../utils/http.js';

export const SORTABLE = ['empId', 'empName', 'department', 'designation', 'status', 'createdAt'];
const SEARCH = ['empId', 'empName', 'department', 'designation', 'unitLine'];

async function validateDropdowns(data) {
  if (data.department !== undefined) {
    await assertValueInList('Department', data.department, { field: 'department', required: true });
  }
  if (data.designation !== undefined) {
    await assertValueInList('Designation', data.designation, { field: 'designation', required: true });
  }
  // unitLine is a free location on the sheet ("Cutting Floor", "QC Hall",
  // "Head Office") as well as a stitching unit, so it is not list-validated.
}

const crud = makeCrud({
  model: 'employee',
  label: 'Employee',
  searchFields: SEARCH,
  sortable: SORTABLE,
  defaultSort: 'empId',
  extraFilters: (where, query) => ({
    ...where,
    ...(query.department ? { department: query.department } : {}),
    ...(query.designation ? { designation: query.designation } : {}),
  }),
  assertDeletable: blockIfReferenced('Employee', [
    { model: 'fabricIssue', field: 'issuedByEmployeeId', what: 'fabric issue(s)' },
    { model: 'fabricScrutiny', field: 'checkedByEmployeeId', what: 'scrutiny report(s)' },
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
export { validateDropdowns as assertDropdowns };

export const list = crud.list;
export const getById = crud.getById;
export const setStatus = crud.setStatus;
export const restore = crud.restore;

export async function create(input, actorId) {
  await validateDropdowns(input);

  const empId = input.empId?.trim() || (await nextNumber('EMPLOYEE'));
  const clash = await prisma.employee.findUnique({ where: { empId }, select: { id: true } });
  if (clash) throw ApiError.conflict('This employee ID is already in use', { field: 'empId' });

  return crud.create({ ...input, empId }, actorId);
}

export async function update(id, input, actorId) {
  await validateDropdowns(input);
  if (input.empId) {
    const clash = await prisma.employee.findFirst({
      where: { empId: input.empId, id: { not: id } },
      select: { id: true },
    });
    if (clash) throw ApiError.conflict('This employee ID is already in use', { field: 'empId' });
  }
  return crud.update(id, input, actorId);
}

/** An employee with a login cannot be deleted - the account would be orphaned. */
export async function remove(id, actorId) {
  const linkedUsers = await prisma.user.count({ where: { employeeId: id, deletedAt: null } });
  if (linkedUsers > 0) {
    throw ApiError.conflict(
      `${linkedUsers} user account(s) are linked to this employee. Unlink or delete them first.`,
      { blockedBy: 'user account(s)', count: linkedUsers },
    );
  }
  return crud.remove(id, actorId);
}

/** Employee dropdown for "Checked By" / "Name" columns. */
export async function options({ department } = {}) {
  return prisma.employee.findMany({
    where: { deletedAt: null, status: 'ACTIVE', ...(department ? { department } : {}) },
    orderBy: { empName: 'asc' },
    take: OPTIONS_LIMIT,
    select: {
      id: true,
      empId: true,
      empName: true,
      department: true,
      designation: true,
      unitLine: true,
    },
  });
}
