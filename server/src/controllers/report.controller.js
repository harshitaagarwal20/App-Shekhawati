import * as service from '../services/report.service.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler, ok } from '../utils/http.js';

/**
 * A UTF-8 byte-order mark on the CSV.
 *
 * Without it Excel opens the file in the system codepage and mangles vendor
 * names — which matters, because reconciling against the workbook is the whole
 * reason these exports exist.
 */
const BOM = '﻿';

/**
 * The reports this user may run, with their filters and columns.
 *
 * The catalogue IS the scope statement: it lists what can be reported on and
 * nothing else, so it no longer carries a paragraph explaining what is absent.
 * Where the pipeline ends is documented in the README and in
 * docs/APPLICATION-FLOW.md, not on a screen an operator reads every day.
 *
 * Optional query parameter:
 * - ?category=INVENTORY - Show only inventory reports
 * - ?category=STAFF_EFFICIENCY - Show only staff efficiency reports
 * - ?category=PLANNING - Show only planning reports
 * - ?category=PROCUREMENT - Show only procurement reports
 */
export const catalogue = asyncHandler(async (req, res) => {
  const category = req.query.category ?? null;
  ok(res, { reports: service.catalogue((code) => req.auth.has(code), category) });
});

/**
 * Authorises a report run from the report's OWN descriptor.
 *
 * Deliberately not `can('SOMETHING.VIEW')` on the route: with fourteen reports
 * that would be fourteen places for the permission to drift from the one
 * declared beside the report. This reads `REPORTS[key].permission` and checks
 * that — so the catalogue and the run can never disagree about who may see
 * what.
 */
export const requireReportPermission = (req, _res, next) => {
  try {
    const report = service.descriptorFor(req.params.key);
    if (!req.auth.has(report.permission)) {
      return next(
        ApiError.forbidden(`The "${report.title}" report requires ${report.permission}`, {
          required: [report.permission],
        }),
      );
    }
    return next();
  } catch (err) {
    return next(err);
  }
};

export const run = asyncHandler(async (req, res) =>
  ok(res, await service.run(req.params.key, req.query)),
);

/** The same report, as a CSV download. */
export const csv = asyncHandler(async (req, res) => {
  // `runForExport`, not `run`: an export is the whole report, never a page of
  // it. The screen pages; the file does not.
  const report = await service.runForExport(req.params.key, req.query);
  const stamp = new Date().toISOString().slice(0, 10);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.key}-${stamp}.csv"`);
  // A BOM, so Excel opens the file as UTF-8 rather than mangling vendor names.
  return res.send(BOM + service.toCsv(report));
});
