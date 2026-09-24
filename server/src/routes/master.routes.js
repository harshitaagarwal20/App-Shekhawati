import { Router } from 'express';
import validate from '../middleware/validate.js';
import { can } from '../middleware/authorize.js';
import * as c from '../controllers/master.controller.js';
import { idParam, listQuery, uuid } from '../validators/common.validator.js';
import {
  buyerListQuery,
  createBuyerSchema,
  createEmployeeSchema,
  createMasterListSchema,
  createStyleSchema,
  createValueSchema,
  createVendorSchema,
  employeeListQuery,
  requirementQuery,
  setActiveSchema,
  setStatusSchema,
  styleListQuery,
  updateBuyerSchema,
  updateEmployeeSchema,
  updateMasterListSchema,
  updateStyleSchema,
  updateValueSchema,
  updateVendorSchema,
  vendorListQuery,
} from '../validators/master.validator.js';
import { z } from 'zod';

const router = Router();

// ===========================================================================
//  LIST MASTER  - every business dropdown in the client reads from here
// ===========================================================================

const listRouter = Router();

// Reading dropdown values needs no MASTER_LIST.VIEW: every screen in the
// application needs its dropdowns, so any authenticated user may read them.
// Editing the lists is what MASTER_LIST.EDIT gates.
listRouter.get('/values', c.getManyListValues);
listRouter.get('/values/:code', validate({ params: z.object({ code: z.string().trim().min(1).max(60) }) }), c.getListValues);

listRouter.get('/', can('MASTER_LIST.VIEW'), validate({ query: listQuery }), c.listMasterLists);
listRouter.post('/', can('MASTER_LIST.CREATE'), validate({ body: createMasterListSchema }), c.createMasterList);
listRouter.get('/:id', can('MASTER_LIST.VIEW'), validate({ params: idParam }), c.getMasterList);
listRouter.patch('/:id', can('MASTER_LIST.EDIT'), validate({ params: idParam, body: updateMasterListSchema }), c.updateMasterList);
listRouter.delete('/:id', can('MASTER_LIST.DELETE'), validate({ params: idParam }), c.deleteMasterList);

listRouter.post('/:id/values', can('MASTER_LIST.EDIT'), validate({ params: idParam, body: createValueSchema }), c.addListValue);
listRouter.patch('/values/:valueId', can('MASTER_LIST.EDIT'), validate({ params: z.object({ valueId: uuid }), body: updateValueSchema }), c.updateListValue);
listRouter.patch('/values/:valueId/active', can('MASTER_LIST.EDIT'), validate({ params: z.object({ valueId: uuid }), body: setActiveSchema }), c.setListValueActive);
listRouter.delete('/values/:valueId', can('MASTER_LIST.DELETE'), validate({ params: z.object({ valueId: uuid }) }), c.deleteListValue);

router.use('/master-lists', listRouter);

// ===========================================================================
//  Helper - one master, one consistent route set
// ===========================================================================

function mountMaster(path, module, handlers, { listSchema, createSchema, updateSchema, extra } = {}) {
  const r = Router();

  // The options endpoint feeds dropdowns on other modules' screens, so it is
  // gated on VIEW of this master rather than on nothing - a merchandiser needs
  // BUYER.VIEW to pick a buyer, which they have.
  if (handlers.options) r.get('/options', can(`${module}.VIEW`), handlers.options);
  if (extra) extra(r);

  r.get('/', can(`${module}.VIEW`), validate({ query: listSchema ?? listQuery }), handlers.list);
  r.post('/', can(`${module}.CREATE`), validate({ body: createSchema }), handlers.create);
  r.get('/:id', can(`${module}.VIEW`), validate({ params: idParam }), handlers.get);
  r.patch('/:id', can(`${module}.EDIT`), validate({ params: idParam, body: updateSchema }), handlers.update);
  r.patch('/:id/status', can(`${module}.EDIT`), validate({ params: idParam, body: setStatusSchema }), handlers.setStatus);
  r.post('/:id/restore', can(`${module}.DELETE`), validate({ params: idParam }), handlers.restore);
  r.delete('/:id', can(`${module}.DELETE`), validate({ params: idParam }), handlers.remove);

  router.use(path, r);
}

// --- Buyers ----------------------------------------------------------------
mountMaster('/buyers', 'BUYER', { ...c.buyers, options: c.buyerOptions }, {
  listSchema: buyerListQuery,
  createSchema: createBuyerSchema,
  updateSchema: updateBuyerSchema,
});

// --- Vendors ---------------------------------------------------------------
mountMaster('/vendors', 'VENDOR', { ...c.vendors, options: c.vendorOptions }, {
  listSchema: vendorListQuery,
  createSchema: createVendorSchema,
  updateSchema: updateVendorSchema,
});

// --- Employees -------------------------------------------------------------
mountMaster('/employees', 'EMPLOYEE', { ...c.employees, options: c.employeeOptions }, {
  listSchema: employeeListQuery,
  createSchema: createEmployeeSchema,
  updateSchema: updateEmployeeSchema,
});

// --- Styles + BOM ----------------------------------------------------------
mountMaster('/styles', 'STYLE', { ...c.styles, options: c.styleOptions }, {
  listSchema: styleListQuery,
  createSchema: createStyleSchema,
  updateSchema: updateStyleSchema,
  extra: (r) =>
    r.get(
      '/:id/requirement',
      can('STYLE.VIEW'),
      validate({ params: idParam, query: requirementQuery }),
      c.styleRequirement,
    ),
});

export default router;
