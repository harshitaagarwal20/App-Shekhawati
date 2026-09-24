/**
 * Controllers for the Phase 2 masters. Thin by design: parse the list query,
 * call the service, shape the response. All rules live in the services.
 */

import * as masterListService from '../services/masterList.service.js';
import * as buyerService from '../services/buyer.service.js';
import * as vendorService from '../services/vendor.service.js';
import * as employeeService from '../services/employee.service.js';
import * as styleService from '../services/style.service.js';
import { asyncHandler, ok, okList, parseListQuery } from '../utils/http.js';

const actor = (req) => req.auth.userId;

// ---------------------------------------------------------------------------
//  List Master
// ---------------------------------------------------------------------------

export const listMasterLists = asyncHandler(async (req, res) => {
  const q = parseListQuery(req, { sortable: masterListService.SORTABLE, defaultSort: 'code' });
  return okList(res, await masterListService.listLists(q));
});

export const getMasterList = asyncHandler(async (req, res) =>
  ok(res, await masterListService.getList(req.params.id)),
);

/** GET /master-lists/values/:code - the endpoint every React dropdown uses. */
export const getListValues = asyncHandler(async (req, res) =>
  ok(
    res,
    await masterListService.getValuesByCode(req.params.code, {
      includeInactive: req.query.includeInactive === 'true',
    }),
  ),
);

/** GET /master-lists/values?codes=UOM,ColorCode,GSM - one round trip per form. */
export const getManyListValues = asyncHandler(async (req, res) => {
  const codes = String(req.query.codes ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  return ok(
    res,
    await masterListService.getManyByCode(codes, {
      includeInactive: req.query.includeInactive === 'true',
    }),
  );
});

export const createMasterList = asyncHandler(async (req, res) =>
  ok(res, await masterListService.createList(req.body, actor(req)), 201),
);

export const updateMasterList = asyncHandler(async (req, res) =>
  ok(res, await masterListService.updateList(req.params.id, req.body, actor(req))),
);

export const deleteMasterList = asyncHandler(async (req, res) =>
  ok(res, await masterListService.removeList(req.params.id, actor(req))),
);

export const addListValue = asyncHandler(async (req, res) =>
  ok(res, await masterListService.addValue(req.params.id, req.body, actor(req)), 201),
);

export const updateListValue = asyncHandler(async (req, res) =>
  ok(res, await masterListService.updateValue(req.params.valueId, req.body, actor(req))),
);

export const setListValueActive = asyncHandler(async (req, res) =>
  ok(res, await masterListService.setValueActive(req.params.valueId, req.body.isActive, actor(req))),
);

export const deleteListValue = asyncHandler(async (req, res) =>
  ok(res, await masterListService.removeValue(req.params.valueId, actor(req))),
);

// ---------------------------------------------------------------------------
//  Generic master handlers
// ---------------------------------------------------------------------------

function masterHandlers(service, { sortable, defaultSort, filterKeys = [] }) {
  return {
    list: asyncHandler(async (req, res) => {
      const q = parseListQuery(req, { sortable, defaultSort });
      const filters = Object.fromEntries(
        filterKeys.filter((k) => req.query[k] !== undefined).map((k) => [k, req.query[k]]),
      );
      return okList(res, await service.list({ ...q, status: req.query.status, ...filters }));
    }),
    get: asyncHandler(async (req, res) => ok(res, await service.getById(req.params.id))),
    create: asyncHandler(async (req, res) => ok(res, await service.create(req.body, actor(req)), 201)),
    update: asyncHandler(async (req, res) =>
      ok(res, await service.update(req.params.id, req.body, actor(req))),
    ),
    setStatus: asyncHandler(async (req, res) =>
      ok(res, await service.setStatus(req.params.id, req.body.status, actor(req))),
    ),
    remove: asyncHandler(async (req, res) => ok(res, await service.remove(req.params.id, actor(req)))),
    restore: asyncHandler(async (req, res) => ok(res, await service.restore(req.params.id, actor(req)))),
  };
}

// --- Buyers ----------------------------------------------------------------
export const buyers = masterHandlers(buyerService, {
  sortable: buyerService.SORTABLE,
  defaultSort: 'buyerName',
  filterKeys: ['country'],
});
export const buyerOptions = asyncHandler(async (_req, res) => ok(res, await buyerService.options()));

// --- Vendors ---------------------------------------------------------------
export const vendors = masterHandlers(vendorService, {
  sortable: vendorService.SORTABLE,
  defaultSort: 'vendorName',
  filterKeys: ['category'],
});
export const vendorOptions = asyncHandler(async (req, res) =>
  ok(res, await vendorService.options({ category: req.query.category })),
);

// --- Employees -------------------------------------------------------------
export const employees = masterHandlers(employeeService, {
  sortable: employeeService.SORTABLE,
  defaultSort: 'empId',
  filterKeys: ['department', 'designation'],
});
export const employeeOptions = asyncHandler(async (req, res) =>
  ok(res, await employeeService.options({ department: req.query.department })),
);

// --- Styles ----------------------------------------------------------------
export const styles = masterHandlers(styleService, {
  sortable: styleService.SORTABLE,
  defaultSort: 'styleNo',
  filterKeys: ['buyerId', 'category'],
});
export const styleOptions = asyncHandler(async (req, res) =>
  ok(res, await styleService.options({ buyerId: req.query.buyerId })),
);
export const styleRequirement = asyncHandler(async (req, res) =>
  ok(res, await styleService.requirementFor(req.params.id, req.query.qty)),
);
