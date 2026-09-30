/**
 * Typed-ish wrappers over the ERP API. One module so every screen calls the
 * same function rather than assembling URLs by hand.
 */

import { request, requestBlob, requestFile, requestList, saveBlob } from './api.js';

// --- Auth ------------------------------------------------------------------

export const auth = {
  login: (body) => request({ method: 'POST', url: '/auth/login', data: body }),
  me: () => request({ method: 'GET', url: '/auth/me' }),
  logout: () => request({ method: 'POST', url: '/auth/logout' }),
  logoutAll: () => request({ method: 'POST', url: '/auth/logout-all' }),
  changePassword: (body) => request({ method: 'POST', url: '/auth/change-password', data: body }),
  sessions: () => request({ method: 'GET', url: '/auth/sessions' }),
};

// --- List Master (every dropdown in the app) --------------------------------

export const masterLists = {
  list: (params) => requestList({ method: 'GET', url: '/master-lists', params }),
  get: (id) => request({ method: 'GET', url: `/master-lists/${id}` }),
  create: (body) => request({ method: 'POST', url: '/master-lists', data: body }),
  update: (id, body) => request({ method: 'PATCH', url: `/master-lists/${id}`, data: body }),
  remove: (id) => request({ method: 'DELETE', url: `/master-lists/${id}` }),

  /** Values of one list, by list CODE - the dropdown endpoint. */
  values: (code, params) => request({ method: 'GET', url: `/master-lists/values/${code}`, params }),
  /** Several lists in one round trip: { UOM: [...], ColorCode: [...] }. */
  manyValues: (codes, params) =>
    request({ method: 'GET', url: '/master-lists/values', params: { codes: codes.join(','), ...params } }),

  addValue: (listId, body) => request({ method: 'POST', url: `/master-lists/${listId}/values`, data: body }),
  updateValue: (valueId, body) => request({ method: 'PATCH', url: `/master-lists/values/${valueId}`, data: body }),
  setValueActive: (valueId, isActive) =>
    request({ method: 'PATCH', url: `/master-lists/values/${valueId}/active`, data: { isActive } }),
  removeValue: (valueId) => request({ method: 'DELETE', url: `/master-lists/values/${valueId}` }),
};

// --- Record masters --------------------------------------------------------

function masterResource(path) {
  return {
    list: (params) => requestList({ method: 'GET', url: `/${path}`, params }),
    get: (id) => request({ method: 'GET', url: `/${path}/${id}` }),
    create: (body) => request({ method: 'POST', url: `/${path}`, data: body }),
    update: (id, body) => request({ method: 'PATCH', url: `/${path}/${id}`, data: body }),
    setStatus: (id, status) => request({ method: 'PATCH', url: `/${path}/${id}/status`, data: { status } }),
    remove: (id) => request({ method: 'DELETE', url: `/${path}/${id}` }),
    restore: (id) => request({ method: 'POST', url: `/${path}/${id}/restore` }),
    options: (params) => request({ method: 'GET', url: `/${path}/options`, params }),
  };
}

export const buyers = masterResource('buyers');

export const vendors = masterResource('vendors');
export const employees = masterResource('employees');

export const styles = {
  ...masterResource('styles'),
  requirement: (id, qty) => request({ method: 'GET', url: `/styles/${id}/requirement`, params: { qty } }),
};

// --- Users and roles -------------------------------------------------------

export const users = {
  list: (params) => requestList({ method: 'GET', url: '/users', params }),
  get: (id) => request({ method: 'GET', url: `/users/${id}` }),
  create: (body) => request({ method: 'POST', url: '/users', data: body }),
  update: (id, body) => request({ method: 'PATCH', url: `/users/${id}`, data: body }),
  setRoles: (id, roleCodes) => request({ method: 'PUT', url: `/users/${id}/roles`, data: { roleCodes } }),
  setActive: (id, isActive) => request({ method: 'PATCH', url: `/users/${id}/active`, data: { isActive } }),
  resetPassword: (id, newPassword) =>
    request({ method: 'POST', url: `/users/${id}/reset-password`, data: { newPassword } }),
  remove: (id) => request({ method: 'DELETE', url: `/users/${id}` }),
};

export const roles = {
  list: (params) => requestList({ method: 'GET', url: '/users/roles', params }),
  get: (id) => request({ method: 'GET', url: `/users/roles/${id}` }),
  permissionCatalogue: () => request({ method: 'GET', url: '/users/roles/permissions' }),
  create: (body) => request({ method: 'POST', url: '/users/roles', data: body }),
  update: (id, body) => request({ method: 'PATCH', url: `/users/roles/${id}`, data: body }),
  setPermissions: (id, permissions) =>
    request({ method: 'PUT', url: `/users/roles/${id}/permissions`, data: { permissions } }),
  remove: (id) => request({ method: 'DELETE', url: `/users/roles/${id}` }),
};

// --- Buyer Orders ----------------------------------------------------------

export const orders = {
  list: (params) => requestList({ method: 'GET', url: '/orders', params }),
  get: (id) => request({ method: 'GET', url: `/orders/${id}` }),
  options: () => request({ method: 'GET', url: '/orders/options' }),
  create: (body) => request({ method: 'POST', url: '/orders', data: body }),
  update: (id, body) => request({ method: 'PATCH', url: `/orders/${id}`, data: body }),
  amend: (id, body) => request({ method: 'POST', url: `/orders/${id}/amend`, data: body }),
  /** Prices per line and the commercial terms - open after the structure locks. */
  setPricing: (id, body) => request({ method: 'PATCH', url: `/orders/${id}/pricing`, data: body }),
  setStatus: (id, status) => request({ method: 'PATCH', url: `/orders/${id}/status`, data: { status } }),
  remove: (id) => request({ method: 'DELETE', url: `/orders/${id}` }),

  /** The Director decision on the "Excess" column. */
  approveExcess: (id, body) => request({ method: 'POST', url: `/orders/${id}/excess/approve`, data: body }),
  rejectExcess: (id, reason) => request({ method: 'POST', url: `/orders/${id}/excess/reject`, data: { reason } }),

  /**
   * Requirement preview for an order that has not been saved yet. The browser
   * never computes quantities - it asks the server, even for a preview.
   */
  preview: (body) => request({ method: 'POST', url: '/orders/preview', data: body }),

  /**
   * The buyer's measurement sheet, and anything else hung off the order.
   *
   * `upload` sends multipart and must NOT set Content-Type: the browser has to
   * write it itself, because only it knows the boundary string it generated.
   * Naming the type here produces a body the server cannot parse.
   */
  attachments: {
    list: (id) => request({ method: 'GET', url: `/orders/${id}/attachments` }),

    upload: (id, file, note) => {
      const body = new FormData();
      body.append('file', file);
      if (note) body.append('note', note);
      return request({ method: 'POST', url: `/orders/${id}/attachments`, data: body });
    },

    remove: (id, attachmentId) =>
      request({ method: 'DELETE', url: `/orders/${id}/attachments/${attachmentId}` }),

    /**
     * Opens the file in a new tab.
     *
     * NOT a plain link. Every route below /api needs the bearer token in a
     * header, and a browser navigating to a URL sends no such header - the
     * link would answer 401. So the bytes are fetched with the token and
     * handed to the browser as a blob it already holds.
     */
    open: async (id, attachmentId, fileName) => {
      const blob = await requestBlob({
        method: 'GET',
        url: `/orders/${id}/attachments/${attachmentId}`,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      if (fileName) a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Give the tab time to take the blob before it is revoked.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
  },
};

// --- Planning ---------------------------------------------------------------

export const plannings = {
  list: (params) => requestList({ method: 'GET', url: '/plannings', params }),
  get: (id) => request({ method: 'GET', url: `/plannings/${id}` }),
  options: (params) => request({ method: 'GET', url: '/plannings/options', params }),
  create: (body) => request({ method: 'POST', url: '/plannings', data: body }),
  update: (id, body) => request({ method: 'PATCH', url: `/plannings/${id}`, data: body }),
  setLines: (id, lines) => request({ method: 'PUT', url: `/plannings/${id}/lines`, data: { lines } }),
  setLineStatus: (id, lineId, body) =>
    request({ method: 'PATCH', url: `/plannings/${id}/lines/${lineId}`, data: body }),
  setStatus: (id, status) =>
    request({ method: 'PATCH', url: `/plannings/${id}/status`, data: { status } }),
  remove: (id) => request({ method: 'DELETE', url: `/plannings/${id}` }),

  // The approval flow: the planner submits, the GM / Director decides.
  submit: (id, body) => request({ method: 'POST', url: `/plannings/${id}/submit`, data: body }),
  recall: (id, reason) => request({ method: 'POST', url: `/plannings/${id}/recall`, data: { reason } }),
  approve: (id, body) => request({ method: 'POST', url: `/plannings/${id}/approve`, data: body }),
  reject: (id, body) => request({ method: 'POST', url: `/plannings/${id}/reject`, data: body }),
  revise: (id, body) => request({ method: 'POST', url: `/plannings/${id}/revise`, data: body }),

  /**
   * What an order permits and what is already planned against it. Read as soon
   * as an order is picked, so the ceiling is on screen before anything is typed.
   */
  orderAllocation: (orderId, params) =>
    request({ method: 'GET', url: `/plannings/order/${orderId}/allocation`, params }),

  /**
   * Checks an unsaved grid against that ceiling. Runs the same server code the
   * save runs - the browser never adds up a plan and decides for itself.
   */
  preview: (body) => request({ method: 'POST', url: '/plannings/preview', data: body }),
};

// --- Vendor Quotations ------------------------------------------------------

export const quotations = {
  list: (params) => requestList({ method: 'GET', url: '/quotations', params }),
  get: (id) => request({ method: 'GET', url: `/quotations/${id}` }),
  options: (params) => request({ method: 'GET', url: '/quotations/options', params }),
  create: (body) => request({ method: 'POST', url: '/quotations', data: body }),
  /** Multi-line: one vendor quote, several items. */
  createDocument: (body) => request({ method: 'POST', url: '/quotations/documents', data: body }),
  getDocument: (id) => request({ method: 'GET', url: `/quotations/documents/${id}` }),
  approveDocument: (id, body) => request({ method: 'POST', url: `/quotations/documents/${id}/approve`, data: body ?? {} }),
  rejectDocument: (id, reason) => request({ method: 'POST', url: `/quotations/documents/${id}/reject`, data: { reason } }),
  update: (id, body) => request({ method: 'PATCH', url: `/quotations/${id}`, data: body }),
  remove: (id) => request({ method: 'DELETE', url: `/quotations/${id}` }),

  // The Director's decision on the "Authorisation Status" column.
  approve: (id, body) => request({ method: 'POST', url: `/quotations/${id}/approve`, data: body }),
  reject: (id, reason) => request({ method: 'POST', url: `/quotations/${id}/reject`, data: { reason } }),
  reopen: (id, reason) => request({ method: 'POST', url: `/quotations/${id}/reopen`, data: { reason } }),

  /**
   * Amount for a quotation that has not been saved yet. The form asks the
   * server rather than multiplying rate by quantity itself - the amount is what
   * gets approved and purchased against, so one piece of code owns it.
   */
  preview: (body) => request({ method: 'POST', url: '/quotations/preview', data: body }),

  /** Every quote raised for one order, grouped by item, cheapest rate marked. */
  compareForOrder: (orderId) => request({ method: 'GET', url: `/quotations/order/${orderId}/compare` }),
};

export const health = () => request({ method: 'GET', url: '/health' });

// --- The dashboard ----------------------------------------------------------

/**
 * Everything the first screen shows, in one call.
 *
 * The server assembles it from whatever this user's permissions allow, so the
 * response shape varies by role: a section that is not theirs arrives as
 * `null`, and one that is theirs but empty arrives as an empty array. The
 * screen renders what it is handed and asks for nothing else - there is no
 * per-tile fetch, and no browser-side count.
 */
export const dashboard = () => request({ method: 'GET', url: '/dashboard' });

// ---------------------------------------------------------------------------
//  PHASES 6-18
//
//  Every function below is a thin wrapper over one REST endpoint. Note what is
//  NOT here: nothing computes an amount, a variation, an excess or a document
//  number. Those all arrive already worked out, because the figure on screen
//  and the figure in the database have to come from one piece of code, and that
//  code runs on the server.
// ---------------------------------------------------------------------------

// --- Purchase Orders --------------------------------------------------------

export const purchaseOrders = {
  list: (params) => requestList({ method: 'GET', url: '/purchase-orders', params }),
  get: (id) => request({ method: 'GET', url: `/purchase-orders/${id}` }),
  options: (params) => request({ method: 'GET', url: '/purchase-orders/options', params }),
  create: (body) => request({ method: 'POST', url: '/purchase-orders', data: body }),
  /** Multi-line: one PO, many items. */
  listDocuments: (params) => requestList({ method: 'GET', url: '/purchase-orders/documents', params }),
  createDocument: (body) => request({ method: 'POST', url: '/purchase-orders/documents', data: body }),
  getDocument: (id) => request({ method: 'GET', url: `/purchase-orders/documents/${id}` }),
  /** Adds a stationery article to L_StationeryItem; returns { value, created }. */
  addStationeryItem: (value) =>
    request({ method: 'POST', url: '/purchase-orders/stationery-items', data: { value } }),
  printDocument: (id) => request({ method: 'GET', url: `/purchase-orders/documents/${id}/print` }),
  approveDocument: (id, body) => request({ method: 'POST', url: `/purchase-orders/documents/${id}/approve`, data: body ?? {} }),
  rejectDocument: (id, reason) => request({ method: 'POST', url: `/purchase-orders/documents/${id}/reject`, data: { reason } }),
  update: (id, body) => request({ method: 'PATCH', url: `/purchase-orders/${id}`, data: body }),
  remove: (id) => request({ method: 'DELETE', url: `/purchase-orders/${id}` }),
  setStatus: (id, status) =>
    request({ method: 'PATCH', url: `/purchase-orders/${id}/status`, data: { status } }),

  // PO Approval - the pipeline's second Director gate.
  approve: (id, body) =>
    request({ method: 'POST', url: `/purchase-orders/${id}/approve`, data: body }),
  reject: (id, reason) =>
    request({ method: 'POST', url: `/purchase-orders/${id}/reject`, data: { reason } }),
  reopen: (id, reason) =>
    request({ method: 'POST', url: `/purchase-orders/${id}/reopen`, data: { reason } }),

  /**
   * The amount AND both quantity ceilings for a PO that has not been saved yet.
   * The form asks rather than multiplying, and rather than guessing what the
   * style permits.
   */
  preview: (body) => request({ method: 'POST', url: '/purchase-orders/preview', data: body }),
  print: (id) => request({ method: 'GET', url: `/purchase-orders/${id}/print` }),
};

// --- Gate Passes ------------------------------------------------------------

export const gatePasses = {
  list: (params) => requestList({ method: 'GET', url: '/gate-passes', params }),
  get: (id) => request({ method: 'GET', url: `/gate-passes/${id}` }),
  options: (params) => request({ method: 'GET', url: '/gate-passes/options', params }),
  create: (body) => request({ method: 'POST', url: '/gate-passes', data: body }),
  update: (id, body) => request({ method: 'PATCH', url: `/gate-passes/${id}`, data: body }),
  remove: (id) => request({ method: 'DELETE', url: `/gate-passes/${id}` }),

  /**
   * The second step: matching a delivery to the document it answers.
   *
   * An inward pass is raised at the gate on the vendor and the time alone; this
   * is what fills in item, quantity, UOM and purpose from the document.
   */
  allocate: (id, body) => request({ method: 'POST', url: `/gate-passes/${id}/allocate`, data: body }),

  /** The goods have been counted at the gate. Variation is computed from it. */
  clear: (id, body) => request({ method: 'POST', url: `/gate-passes/${id}/clear`, data: body }),
  reopen: (id, reason) =>
    request({ method: 'POST', url: `/gate-passes/${id}/reopen`, data: { reason } }),

  /** Resolves the linked document and works out qty and variation beforehand. */
  preview: (body) => request({ method: 'POST', url: '/gate-passes/preview', data: body }),
  print: (id) => request({ method: 'GET', url: `/gate-passes/${id}/print` }),
};

// --- GRN --------------------------------------------------------------------

export const grns = {
  list: (params) => requestList({ method: 'GET', url: '/grns', params }),
  get: (id) => request({ method: 'GET', url: `/grns/${id}` }),

  /**
   * Posts a receipt: GRN + Fabric Roll + Stock Ledger IN, in one transaction.
   * There is no separate "post" call, because a GRN that has not reached the
   * ledger is not a state this system holds.
   */
  create: (body) => request({ method: 'POST', url: '/grns', data: body }),
  /** Multi-line: one delivery, one bill, several PO lines. */
  createDocument: (body) => request({ method: 'POST', url: '/grns/documents', data: body }),
  getDocument: (id) => request({ method: 'GET', url: `/grns/documents/${id}` }),
  update: (id, body) => request({ method: 'PATCH', url: `/grns/${id}`, data: body }),
  remove: (id) => request({ method: 'DELETE', url: `/grns/${id}` }),

  preview: (body) => request({ method: 'POST', url: '/grns/preview', data: body }),

  /** The goods receipt note - what arrived. */
  print: (id) => request({ method: 'GET', url: `/grns/${id}/print` }),
  /** The purchase invoice - what it cost, with the GST the vendor charged. */
  invoice: (id) => request({ method: 'GET', url: `/grns/${id}/invoice` }),
  /** The GST slabs, for the rate dropdown on the receipt form. */
  gstRates: () => request({ method: 'GET', url: '/grns/meta/gst-rates' }),
};

// --- GRN reversal -----------------------------------------------------------

/**
 * F-04 - the compensating document a posted receipt is corrected by.
 *
 * A receipt posts to stock the instant it is saved, so a mis-keyed one cannot
 * be edited or cancelled - it is undone by an approved counter-entry that
 * takes the goods back out and returns the quantity to the purchase order.
 *
 * Note what is NOT here: no `post`. Approving a reversal posts it, in the same
 * transaction, so there is no state in which the correction is authorised and
 * the ledger is still wrong.
 */
export const grnReversals = {
  /**
   * Whether a receipt can still be corrected, and what a reversal would undo.
   *
   * Asked by the GRN screen BEFORE any reversal exists, which is why it is
   * keyed on the receipt and guarded by GRN.VIEW. Returns the blockers as
   * sentences rather than a bare false: "roll FAB-0007 has been drawn on" is
   * something the storeman can act on, and "not allowed" is not.
   */
  eligibility: (grnId) => request({ method: 'GET', url: `/grn-reversals/eligibility/${grnId}` }),

  list: (params) => requestList({ method: 'GET', url: '/grn-reversals', params }),
  get: (id) => request({ method: 'GET', url: `/grn-reversals/${id}` }),

  /**
   * Raises one against a posted receipt. Submitted for approval in the same
   * call unless `submit: false` - two round trips to say "this receipt is
   * wrong" are two chances to leave the correction in a drawer while the
   * ledger stays wrong.
   *
   * The body carries only the receipt and the reason. Every figure is copied
   * off the receipt by the server, so what the approver signs is what happens.
   */
  create: (body) => request({ method: 'POST', url: '/grn-reversals', data: body }),
  update: (id, body) => request({ method: 'PATCH', url: `/grn-reversals/${id}`, data: body }),
  remove: (id) => request({ method: 'DELETE', url: `/grn-reversals/${id}` }),

  submit: (id, body) => request({ method: 'POST', url: `/grn-reversals/${id}/submit`, data: body }),
  /** Approves AND posts. The counter-movements are written by this call. */
  approve: (id, body) =>
    request({ method: 'POST', url: `/grn-reversals/${id}/approve`, data: body ?? {} }),
  reject: (id, reason) =>
    request({ method: 'POST', url: `/grn-reversals/${id}/reject`, data: { reason } }),
  cancel: (id, reason) =>
    request({ method: 'POST', url: `/grn-reversals/${id}/cancel`, data: { reason } }),
};

// --- Inventory, stock ledger and rolls --------------------------------------

export const inventory = {
  /**
   * On-hand by item and location, valued, with low stock called out.
   *
   * Paginated like every other list, so `meta` carries page / pageCount - and
   * `meta.totals` carries lines, value and the below-reorder tally for the
   * WHOLE filter rather than the page. Those three are what the tiles above
   * the table show, and they must not move when you turn the page.
   */
  stock: (params) => requestList({ method: 'GET', url: '/inventory/stock', params }),

  /**
   * The register: date, item, category, roll, colour, GSM, content, UOM,
   * quantity in, quantity out, rate, order, reference and user.
   *
   * There is deliberately no POST counterpart. Stock moves only as a
   * consequence of a document.
   */
  ledger: (params) => requestList({ method: 'GET', url: '/inventory/stock/ledger', params }),

  /** Rebuilds the balance cache from the ledger; dryRun reports differences. */
  reconcile: (dryRun) =>
    request({ method: 'POST', url: '/inventory/stock/reconcile', params: { dryRun } }),

  items: (params) => requestList({ method: 'GET', url: '/inventory/items', params }),
  item: (id) => request({ method: 'GET', url: `/inventory/items/${id}` }),
  updateItem: (id, body) => request({ method: 'PATCH', url: `/inventory/items/${id}`, data: body }),
  itemOptions: (params) => request({ method: 'GET', url: '/inventory/items/options', params }),

  rolls: (params) => requestList({ method: 'GET', url: '/inventory/rolls', params }),
  /** One roll, with its whole chain: GRN, vendor, PO, order, issue history. */
  roll: (id) => request({ method: 'GET', url: `/inventory/rolls/${id}` }),
  relocateRoll: (id, body) =>
    request({ method: 'PATCH', url: `/inventory/rolls/${id}/location`, data: body }),
  /** Grade a roll's shade band and dye lot. Closed once the roll has been cut from. */
  markRollShade: (id, body) =>
    request({ method: 'PATCH', url: `/inventory/rolls/${id}/shade`, data: body }),
};

// --- Fabric Issue (shop floor) ----------------------------------------------

export const fabricIssues = {
  list: (params) => requestList({ method: 'GET', url: '/fabric-issues', params }),
  get: (id) => request({ method: 'GET', url: `/fabric-issues/${id}` }),

  /** Creating one POSTS it: the issue and its ledger OUT are one transaction. */
  create: (body) => request({ method: 'POST', url: '/fabric-issues', data: body }),
  update: (id, body) => request({ method: 'PATCH', url: `/fabric-issues/${id}`, data: body }),
  remove: (id) => request({ method: 'DELETE', url: `/fabric-issues/${id}` }),

  /** "Can I issue this much off this roll?" - the shop floor's real question. */
  preview: (body) => request({ method: 'POST', url: '/fabric-issues/preview', data: body }),
  /** The roll picker: one call, everything a phone needs to render a list. */
  rolls: (params) => request({ method: 'GET', url: '/fabric-issues/rolls', params }),
  /** The challan that travels with the fabric to the job worker. */
  print: (id) => request({ method: 'GET', url: `/fabric-issues/${id}/print` }),
};

// --- Job Work: Dyeing / Printing / Finishing ----------------------

export const jobWorks = {
  list: (params) => requestList({ method: 'GET', url: '/job-works', params }),
  get: (id) => request({ method: 'GET', url: `/job-works/${id}` }),
  options: (params) => request({ method: 'GET', url: '/job-works/options', params }),
  create: (body) => request({ method: 'POST', url: '/job-works', data: body }),
  update: (id, body) => request({ method: 'PATCH', url: `/job-works/${id}`, data: body }),
  remove: (id) => request({ method: 'DELETE', url: `/job-works/${id}` }),

  /**
   * C3 - a job work order is [A][S]. It is raised as a DRAFT and must be
   * APPROVED before any fabric may be issued against it: the company is putting
   * its own cloth in another firm's building, and that takes a signature.
   *
   * Approving does not move stock. The Fabric Issue against the approved order
   * posts both ledger legs and transitions this document to POSTED.
   */
  submit: (id, body) => request({ method: 'POST', url: `/job-works/${id}/submit`, data: body }),
  approve: (id, body) => request({ method: 'POST', url: `/job-works/${id}/approve`, data: body }),
  reject: (id, reason) =>
    request({ method: 'POST', url: `/job-works/${id}/reject`, data: { reason } }),

  /** Booking a return: receipt, ledger IN, roll and totals, atomically. */
  receive: (id, body) => request({ method: 'POST', url: `/job-works/${id}/receive`, data: body }),

  preview: (body) => request({ method: 'POST', url: '/job-works/preview', data: body }),
  previewReceipt: (body) =>
    request({ method: 'POST', url: '/job-works/preview-receipt', data: body }),
  print: (id) => request({ method: 'GET', url: `/job-works/${id}/print` }),

  /**
   * The four processes with their vocabulary. The UI reads this so a printing
   * job is never labelled as a dyeing job, whatever they share underneath.
   */
  processes: () => request({ method: 'GET', url: '/job-works/processes' }),
};

// --- Fabric Scrutiny --------------------------------------------------------

export const scrutinies = {
  list: (params) => requestList({ method: 'GET', url: '/scrutinies', params }),
  get: (id) => request({ method: 'GET', url: `/scrutinies/${id}` }),
  create: (body) => request({ method: 'POST', url: '/scrutinies', data: body }),
  update: (id, body) => request({ method: 'PATCH', url: `/scrutinies/${id}`, data: body }),
  remove: (id) => request({ method: 'DELETE', url: `/scrutinies/${id}` }),

  /** The decision, which LOCKS the record. A one-way door. */
  finalise: (id, body) => request({ method: 'POST', url: `/scrutinies/${id}/finalise`, data: body }),
  /** The only way a locked scrutiny changes - it keeps the before/after set. */
  amend: (id, body) => request({ method: 'POST', url: `/scrutinies/${id}/amend`, data: body }),

  preview: (body) => request({ method: 'POST', url: '/scrutinies/preview', data: body }),
  decisions: () => request({ method: 'GET', url: '/scrutinies/decisions' }),
};

// --- Cutting Challan (C5) ---------------------------------------------------
//
//  The requirement the cutting department raises BEFORE any fabric is issued.
//  Approval-enabled: fabric may only be issued against an approved challan, and
//  `issuableLines` is what the Fabric Issue screen offers - so the form cannot
//  present a line the posting would refuse.

export const cuttingChallans = {
  list: (params) => requestList({ method: 'GET', url: '/cutting-challans', params }),
  get: (id) => request({ method: 'GET', url: `/cutting-challans/${id}` }),
  create: (body) => request({ method: 'POST', url: '/cutting-challans', data: body }),
  update: (id, body) => request({ method: 'PATCH', url: `/cutting-challans/${id}`, data: body }),
  remove: (id) => request({ method: 'DELETE', url: `/cutting-challans/${id}` }),

  submit: (id, body) => request({ method: 'POST', url: `/cutting-challans/${id}/submit`, data: body }),
  approve: (id, body) => request({ method: 'POST', url: `/cutting-challans/${id}/approve`, data: body }),
  reject: (id, reason) =>
    request({ method: 'POST', url: `/cutting-challans/${id}/reject`, data: { reason } }),

  /** Abandon the outstanding quantity, deliberately and on the record. */
  closeShort: (id, body) =>
    request({ method: 'POST', url: `/cutting-challans/${id}/close-short`, data: body }),
  cancel: (id, reason) =>
    request({ method: 'POST', url: `/cutting-challans/${id}/cancel`, data: { reason } }),

  /** Lines with something still outstanding, for the Fabric Issue picker. */
  issuableLines: (params) =>
    request({ method: 'GET', url: '/cutting-challans/issuable-lines', params }),
  preview: (body) => request({ method: 'POST', url: '/cutting-challans/preview', data: body }),
};

// --- Cut Pieces Receipt -------------------------------------------------------

/** Cut pieces counted in from the cutting department, before issue to stitching. */
export const cutPiecesReceipts = {
  list: (params) => requestList({ method: 'GET', url: '/cut-pieces-receipts', params }),
  get: (id) => request({ method: 'GET', url: `/cut-pieces-receipts/${id}` }),
  create: (body) => request({ method: 'POST', url: '/cut-pieces-receipts', data: body }),
  update: (id, body) => request({ method: 'PATCH', url: `/cut-pieces-receipts/${id}`, data: body }),
  remove: (id) => request({ method: 'DELETE', url: `/cut-pieces-receipts/${id}` }),
  /** Pieces in hand for an order: received from cutting, less issued to stitching. */
  summary: (params) => request({ method: 'GET', url: '/cut-pieces-receipts/summary', params }),
  nextNumber: () => request({ method: 'GET', url: '/cut-pieces-receipts/next-number' }),
};

// --- Material Plan (C12) ----------------------------------------------------

/**
 * The raw material plan: what fabric and accessories an order needs bought in.
 *
 * There is no `setLines` and no line payload anywhere below, deliberately. The
 * lines are the Style BOM exploded through the shared requirement calculation
 * and frozen at creation - the server has nowhere to put a line a client sent.
 * A figure that looks wrong is wrong on the Style Master, and fixing it there
 * fixes the PO ceiling and the cutting challan with it.
 */
export const materialPlans = {
  list: (params) => requestList({ method: 'GET', url: '/material-plans', params }),
  get: (id) => request({ method: 'GET', url: `/material-plans/${id}` }),
  create: (body) => request({ method: 'POST', url: '/material-plans', data: body }),
  update: (id, body) => request({ method: 'PATCH', url: `/material-plans/${id}`, data: body }),
  remove: (id) => request({ method: 'DELETE', url: `/material-plans/${id}` }),

  submit: (id, body) => request({ method: 'POST', url: `/material-plans/${id}/submit`, data: body }),
  approve: (id, body) => request({ method: 'POST', url: `/material-plans/${id}/approve`, data: body }),
  reject: (id, reason) =>
    request({ method: 'POST', url: `/material-plans/${id}/reject`, data: { reason } }),
  cancel: (id, reason) =>
    request({ method: 'POST', url: `/material-plans/${id}/cancel`, data: { reason } }),

  /** What the plan would contain, through the same code path the save uses. */
  preview: (body) => request({ method: 'POST', url: '/material-plans/preview', data: body }),
  /** Whether the style BOM has moved since the plan was signed. A read only. */
  drift: (id) => request({ method: 'GET', url: `/material-plans/${id}/drift` }),
};

// --- Tolerance masters (C2 / C3) --------------------------------------------

export const tolerances = {
  list: (params) => request({ method: 'GET', url: '/tolerances', params }),
  add: (body) => request({ method: 'POST', url: '/tolerances', data: body }),
  /** Categories with no explicit dated rule - reported, never assumed. */
  gaps: (params) => request({ method: 'GET', url: '/tolerances/gaps', params }),
  categories: () => request({ method: 'GET', url: '/tolerances/categories' }),
  resolve: (params) => request({ method: 'GET', url: '/tolerances/resolve', params }),

  shrinkage: (params) => request({ method: 'GET', url: '/tolerances/shrinkage', params }),
  addShrinkage: (body) => request({ method: 'POST', url: '/tolerances/shrinkage', data: body }),
  resolveShrinkage: (params) =>
    request({ method: 'GET', url: '/tolerances/shrinkage/resolve', params }),
};

// --- Plan Approval (versioned) ----------------------------------------------

export const planApprovals = {
  list: (params) => requestList({ method: 'GET', url: '/plan-approvals', params }),
  get: (id) => request({ method: 'GET', url: `/plan-approvals/${id}` }),
  options: (params) => request({ method: 'GET', url: '/plan-approvals/options', params }),

  /** Version 1. Every later version is raised by rectify(), never here. */
  create: (body) => request({ method: 'POST', url: '/plan-approvals', data: body }),
  update: (id, body) => request({ method: 'PATCH', url: `/plan-approvals/${id}`, data: body }),
  remove: (id) => request({ method: 'DELETE', url: `/plan-approvals/${id}` }),

  /** Approves AND locks in one write - an approved version is immutable. */
  approve: (id, body) =>
    request({ method: 'POST', url: `/plan-approvals/${id}/approve`, data: body }),
  reject: (id, body) => request({ method: 'POST', url: `/plan-approvals/${id}/reject`, data: body }),
  /** Rectifies a rejection by raising the NEXT version. */
  rectify: (id, body) =>
    request({ method: 'POST', url: `/plan-approvals/${id}/rectify`, data: body }),
  recall: (id, reason) =>
    request({ method: 'POST', url: `/plan-approvals/${id}/recall`, data: { reason } }),

  /** The version history for one order, grouped by container. */
  forOrder: (orderId) => request({ method: 'GET', url: `/plan-approvals/order/${orderId}` }),
  nextVersion: (id) => request({ method: 'GET', url: `/plan-approvals/${id}/next-version` }),
};

// --- Cutting Issue (the last module) ----------------------------------------

export const cuttingIssues = {
  list: (params) => requestList({ method: 'GET', url: '/cutting-issues', params }),
  get: (id) => request({ method: 'GET', url: `/cutting-issues/${id}` }),
  create: (body) => request({ method: 'POST', url: '/cutting-issues', data: body }),
  update: (id, body) => request({ method: 'PATCH', url: `/cutting-issues/${id}`, data: body }),
  remove: (id) => request({ method: 'DELETE', url: `/cutting-issues/${id}` }),

  /**
   * POST THE CHALLAN. All nine checks run again inside the transaction, any
   * excess authorisation is spent, and the document locks permanently.
   */
  post: (id, body) => request({ method: 'POST', url: `/cutting-issues/${id}/post`, data: body }),
  cancel: (id, reason) =>
    request({ method: 'POST', url: `/cutting-issues/${id}/cancel`, data: { reason } }),

  /** Runs the nine checks against a challan that has not been saved yet. */
  preview: (body) => request({ method: 'POST', url: '/cutting-issues/preview', data: body }),
  print: (id) => request({ method: 'GET', url: `/cutting-issues/${id}/print` }),
  checklist: () => request({ method: 'GET', url: '/cutting-issues/checklist' }),
};

// --- Excess / wastage control -----------------------------------------------

export const excess = {
  /** The scopes and their precedence, so the rules screen explains itself. */
  scopes: () => request({ method: 'GET', url: '/excess/scopes' }),

  /**
   * Measures a quantity against its CONFIGURED threshold, without saving.
   *
   * Returns every figure the brief asks to be identified: base quantity,
   * permitted %, permitted quantity, actual excess, excess %, and the verdict.
   * No percentage is hardcoded anywhere - not here, and not on the server.
   */
  assess: (body) => request({ method: 'POST', url: '/excess/assess', data: body }),

  rules: (params) => requestList({ method: 'GET', url: '/excess/rules', params }),
  createRule: (body) => request({ method: 'POST', url: '/excess/rules', data: body }),
  updateRule: (id, body) => request({ method: 'PATCH', url: `/excess/rules/${id}`, data: body }),
  removeRule: (id) => request({ method: 'DELETE', url: `/excess/rules/${id}` }),

  approvals: (params) => requestList({ method: 'GET', url: '/excess/approvals', params }),
  approval: (id) => request({ method: 'GET', url: `/excess/approvals/${id}` }),
  request: (body) => request({ method: 'POST', url: '/excess/approvals', data: body }),
  approve: (id, body) =>
    request({ method: 'POST', url: `/excess/approvals/${id}/approve`, data: body }),
  reject: (id, reason) =>
    request({ method: 'POST', url: `/excess/approvals/${id}/reject`, data: { reason } }),
};

// --- The approval engine ----------------------------------------------------

export const workflow = {
  /** The whole state machine, for a screen to draw a progress trail from. */
  states: () => request({ method: 'GET', url: '/workflow/states' }),
  /** Everything waiting on a decision, across every module, in one list. */
  queue: (params) => request({ method: 'GET', url: '/workflow/queue', params }),
  /** One document's position, its trail, and what it may do next. */
  status: (documentType, documentId) =>
    request({ method: 'GET', url: `/workflow/${documentType}/${documentId}` }),

  /** One document's own stage events, for the trail on its detail screen. */
  stageEvents: (documentType, documentId) =>
    request({ method: 'GET', url: `/workflow/${documentType}/${documentId}/stage-events` }),
};

// --- Operational reports ----------------------------------------------------

export const reports = {
  /**
   * The reports this user may run — the server has already filtered the
   * catalogue by permission, and checks it again on every run.
   *
   * Each descriptor carries its own filters and columns, which is what lets one
   * React screen render all fourteen.
   *
   * @param category - Optional: filter by category (INVENTORY, STAFF_EFFICIENCY, PLANNING, PROCUREMENT)
   */
  catalogue: (category) => request({ method: 'GET', url: '/reports', params: category ? { category } : {} }),

  run: (key, params) => request({ method: 'GET', url: `/reports/${key}`, params }),

  /**
   * The report as a CSV, rendered on the server.
   *
   * The figures in the file and the figures on screen come from one piece of
   * code; a client-side CSV writer would be a second place a number could be
   * formatted, and a spreadsheet is exactly where that discrepancy would be
   * found months later.
   *
   * ---------------------------------------------------------------------------
   *  THIS FETCHES THE BYTES. IT USED TO BE A LINK, AND A LINK CANNOT WORK.
   *
   *  It was `<a href={csvUrl(...)}>`, on the reasoning that the browser should
   *  do the download. But every route below /api needs the bearer token in an
   *  Authorization HEADER, and a browser navigating to a URL sends no such
   *  header - so the link answered 401 and opened a tab of JSON. The token is
   *  in localStorage, not in a cookie, precisely so that it is never sent by
   *  something that did not mean to send it, and that is the trade-off being
   *  honoured here rather than worked around.
   *
   *  So the bytes are fetched WITH the token and handed to the browser as an
   *  object URL it already holds - the same thing the order attachments do, and
   *  the same thing every table export does.
   * ---------------------------------------------------------------------------
   */
  downloadCsv: async (key, params = {}) => {
    const clean = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    );
    const { blob, fileName } = await requestFile({
      method: 'GET',
      url: `/reports/${key}/csv`,
      params: clean,
    });
    saveBlob(blob, fileName ?? `${key}.csv`);
  },
};

// --- The audit trail --------------------------------------------------------

/**
 * Read-only, deliberately.
 *
 * There is no create, update or delete here because there is none on the
 * server either. See server/src/routes/audit.routes.js.
 */
export const audit = {
  list: (params) => request({ method: 'GET', url: '/audit', params }),
  getById: (id) => request({ method: 'GET', url: `/audit/${id}` }),
  /** Writes, decisions and amendments for one record, merged in time order. */
  trail: (tableName, recordId) =>
    request({ method: 'GET', url: `/audit/trail/${tableName}/${recordId}` }),
  tables: () => request({ method: 'GET', url: '/audit/tables' }),
  actors: () => request({ method: 'GET', url: '/audit/actors' }),
  summary: (params) => request({ method: 'GET', url: '/audit/summary', params }),
};

// --- Tables out, masters in -------------------------------------------------

/**
 * Downloading a table.
 *
 * One endpoint serves every table in the application - see the registry in
 * server/src/services/dataset.registry.js - so this is one wrapper rather than
 * an `export` on each of the twenty-nine resource objects above.
 *
 * The filters are the ones the SCREEN was showing, passed through unchanged.
 * That is the whole contract: what comes down is the list you are looking at,
 * every page of it, and nothing else.
 */
export const dataExports = {
  /** The tables this user may download. Filtered by permission on the server. */
  catalogue: () => request({ method: 'GET', url: '/exports' }),

  /**
   * Fetches one and hands it to the browser. Resolves with the row count, so
   * the screen can say what it just saved.
   */
  download: async (key, params = {}) => {
    const clean = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    );
    const { blob, fileName, rowCount } = await requestFile({
      method: 'GET',
      url: `/exports/${key}/csv`,
      params: clean,
    });
    saveBlob(blob, fileName ?? `${key}.csv`);
    return { rowCount };
  },
};

/**
 * Importing a master.
 *
 * `check` and `apply` are the SAME request with one flag different, and the
 * screen sends the same File object to both - so what is applied is what was
 * checked, rather than a second upload that could differ from the one the user
 * approved.
 */
export const dataImports = {
  /** The masters this user may import. */
  catalogue: () => request({ method: 'GET', url: '/imports' }),

  /** Its columns, which are required, and the hint for each. */
  spec: (key) => request({ method: 'GET', url: `/imports/${key}` }),

  /** A blank file with just the header row. */
  template: async (key) => {
    const blob = await requestBlob({ method: 'GET', url: `/imports/${key}/template` });
    saveBlob(blob, `${key}-import-template.csv`);
  },

  /*
   * Multipart, and deliberately NOT setting Content-Type: only the browser
   * knows the boundary string it generated, so naming the type here produces a
   * body the server cannot parse.
   */
  send: (key, file, { mode = 'upsert', dryRun = true } = {}) => {
    const body = new FormData();
    body.append('file', file);
    body.append('mode', mode);
    body.append('dryRun', String(dryRun));
    return request({ method: 'POST', url: `/imports/${key}`, data: body });
  },

  /** Checks a file and reports what it would do. Writes nothing. */
  check: (key, file, mode) => dataImports.send(key, file, { mode, dryRun: true }),

  /** Applies the file that was checked. */
  apply: (key, file, mode) => dataImports.send(key, file, { mode, dryRun: false }),
};

// --- Notifications (the caller's own inbox) ---------------------------------

export const notifications = {
  list: (params) => request({ method: 'GET', url: '/notifications', params }),
  unreadCount: () => request({ method: 'GET', url: '/notifications/unread-count' }),
  /** No ids: mark everything read. */
  markRead: (ids) => request({ method: 'POST', url: '/notifications/read', data: ids ? { ids } : {} }),
  preferences: () => request({ method: 'GET', url: '/notifications/preferences' }),
  setPreferences: (body) => request({ method: 'PATCH', url: '/notifications/preferences', data: body }),
};

// --- Cost sheets (FOB costing) ---------------------------------------------

export const costSheets = {
  list: (params) => requestList({ method: 'GET', url: '/cost-sheets', params }),
  get: (id) => request({ method: 'GET', url: `/cost-sheets/${id}` }),
  create: (body) => request({ method: 'POST', url: '/cost-sheets', data: body }),
  update: (id, body) => request({ method: 'PATCH', url: `/cost-sheets/${id}`, data: body }),
  remove: (id) => request({ method: 'DELETE', url: `/cost-sheets/${id}` }),
  refreshRates: (id) => request({ method: 'POST', url: `/cost-sheets/${id}/refresh-rates` }),
  submit: (id, body) => request({ method: 'POST', url: `/cost-sheets/${id}/submit`, data: body ?? {} }),
  approve: (id, body) => request({ method: 'POST', url: `/cost-sheets/${id}/approve`, data: body ?? {} }),
  reject: (id, body) => request({ method: 'POST', url: `/cost-sheets/${id}/reject`, data: body }),
  revise: (id) => request({ method: 'POST', url: `/cost-sheets/${id}/revise` }),
};
