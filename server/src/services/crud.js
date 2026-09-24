/**
 * Shared CRUD core for the record masters (Buyer, Vendor, Employee, Style).
 *
 * All four behave identically where it does not matter - list with
 * search / filter / sort / paginate, soft delete, active-inactive toggle,
 * audit columns - and differ only in their fields, their auto-code rule and
 * what blocks a delete. Those differences are passed in; nothing else is.
 */

import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { searchFilter } from '../utils/http.js';

/**
 * @param {object} cfg
 * @param {string}   cfg.model         Prisma model name, e.g. 'buyer'
 * @param {string}   cfg.label         Human label, e.g. 'Buyer'
 * @param {string[]} cfg.searchFields  Columns the free-text search covers
 * @param {string[]} cfg.sortable      Columns that may be sorted on
 * @param {string}   cfg.defaultSort
 * @param {object}   [cfg.include]     Prisma include for detail reads
 * @param {(row:any)=>any} [cfg.project]
 * @param {(where:object, query:object)=>object} [cfg.extraFilters]
 * @param {(id:string)=>Promise<void>} [cfg.assertDeletable]
 */
export function makeCrud(cfg) {
  const model = () => prisma[cfg.model];
  const project = cfg.project ?? ((row) => row);

  async function list(query) {
    const { page, pageSize, skip, take, orderBy, search, includeDeleted, status } = query;

    let where = {
      ...(includeDeleted ? {} : { deletedAt: null }),
      ...(status ? { status } : {}),
      ...searchFilter(search, cfg.searchFields),
    };
    if (cfg.extraFilters) where = cfg.extraFilters(where, query);

    const [rows, total] = await Promise.all([
      model().findMany({ where, orderBy, skip, take, ...(cfg.listInclude ? { include: cfg.listInclude } : {}) }),
      model().count({ where }),
    ]);

    return { rows: rows.map(project), total, page, pageSize };
  }

  async function getById(id, { includeDeleted = false } = {}) {
    const row = await model().findFirst({
      where: { id, ...(includeDeleted ? {} : { deletedAt: null }) },
      ...(cfg.include ? { include: cfg.include } : {}),
    });
    if (!row) throw ApiError.notFound(cfg.label);
    return project(row);
  }

  async function create(data, actorId) {
    const row = await model().create({
      data: { ...data, createdById: actorId, updatedById: actorId },
      ...(cfg.include ? { include: cfg.include } : {}),
    });
    return project(row);
  }

  async function update(id, data, actorId) {
    await getById(id);
    const row = await model().update({
      where: { id },
      data: { ...data, updatedById: actorId },
      ...(cfg.include ? { include: cfg.include } : {}),
    });
    return project(row);
  }

  /**
   * Active/inactive control. Deactivating never deletes: existing documents
   * keep their reference, the record simply stops appearing in new dropdowns.
   */
  async function setStatus(id, status, actorId) {
    await getById(id);
    const row = await model().update({
      where: { id },
      data: { status, updatedById: actorId },
      ...(cfg.include ? { include: cfg.include } : {}),
    });
    return project(row);
  }

  /**
   * Soft delete. Refused when the record is referenced by a document, because
   * an ERP that lets a buyer vanish from under a live order is not usable.
   */
  async function remove(id, actorId) {
    await getById(id);
    if (cfg.assertDeletable) await cfg.assertDeletable(id);

    await model().update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: actorId, ...(cfg.hasStatus === false ? {} : { status: 'INACTIVE' }) },
    });
    return { deleted: true };
  }

  async function restore(id, actorId) {
    const row = await model().findFirst({ where: { id } });
    if (!row) throw ApiError.notFound(cfg.label);
    if (!row.deletedAt) throw ApiError.badRequest(`${cfg.label} is not deleted`);

    const restored = await model().update({
      where: { id },
      data: { deletedAt: null, deletedById: null, updatedById: actorId },
      ...(cfg.include ? { include: cfg.include } : {}),
    });
    return project(restored);
  }

  return { list, getById, create, update, setStatus, remove, restore, config: cfg };
}

/**
 * Builds an `assertDeletable` that refuses when any of the named relations
 * still holds a non-deleted row.
 *
 * @param {string} label
 * @param {{model:string, field:string, what:string}[]} refs
 */
export function blockIfReferenced(label, refs) {
  return async (id) => {
    for (const ref of refs) {
      const count = await prisma[ref.model].count({
        where: { [ref.field]: id, deletedAt: null },
      });
      if (count > 0) {
        throw ApiError.conflict(
          `This ${label.toLowerCase()} is used by ${count} ${ref.what}. Deactivate it instead of deleting.`,
          { blockedBy: ref.what, count },
        );
      }
    }
  };
}
