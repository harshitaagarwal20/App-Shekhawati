/**
 * Tables out, masters in.
 *
 * Thin, like every controller here: parse, call, shape. The two things it does
 * own are the permission checks, and they are both read from the REGISTRY
 * rather than taken from the request - see the note on each.
 */

import * as exportService from '../services/export.service.js';
import * as importService from '../services/import.service.js';
import { MASTER_IMPORTS } from '../services/import.service.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler, ok } from '../utils/http.js';

const actor = (req) => req.auth.userId;

// ===========================================================================
//  EXPORT
// ===========================================================================

/** The tables this user may download. Filtered by permission, then re-checked. */
export const catalogue = asyncHandler(async (req, res) =>
  ok(res, { datasets: exportService.catalogue((code) => req.auth.has(code)) }),
);

/**
 * Authorises a download from the DATASET'S OWN descriptor.
 *
 * Deliberately not a `can('SOMETHING.EXPORT')` on the route: with twenty-eight
 * datasets on one route that would be a permission taken from the URL, which
 * is a permission the caller nominated. This reads `module` off the registry
 * entry and checks `<module>.EXPORT`, so the catalogue and the download can
 * never disagree about who may see what.
 */
export const requireExportPermission = (req, _res, next) => {
  try {
    const dataset = exportService.descriptorFor(req.params.key);
    const code = `${dataset.module}.EXPORT`;
    if (!req.auth.has(code)) {
      return next(
        ApiError.forbidden(`Downloading ${dataset.title} requires ${code}`, { required: [code] }),
      );
    }
    return next();
  } catch (err) {
    return next(err);
  }
};

export const csv = asyncHandler(async (req, res) => {
  const result = await exportService.runExport(req.params.key, req.query);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${exportService.fileNameFor(result)}"`);
  // The row count as a header, so the client can say "1,284 rows" beside the
  // download without opening the file it just handed to the browser.
  res.setHeader('X-Row-Count', String(result.total));
  return res.send(exportService.toCsvFile(result));
});

// ===========================================================================
//  IMPORT
// ===========================================================================

export const importCatalogue = asyncHandler(async (req, res) =>
  ok(res, { masters: importService.importCatalogue((code) => req.auth.has(code)) }),
);

export const importFields = asyncHandler(async (req, res) =>
  ok(res, importService.importSpec(req.params.key)),
);

/**
 * The floor: you need CREATE or EDIT on the master to reach the importer at
 * all. Which of the two the FILE actually needs is decided in the service,
 * once the rows have been read - a file that only corrects existing vendors
 * needs EDIT, and one that adds new ones needs CREATE, and no route can tell
 * those apart before parsing the upload.
 */
export const requireImportPermission = (req, _res, next) => {
  const spec = MASTER_IMPORTS[req.params.key];
  if (!spec) return next(ApiError.notFound(`Import "${req.params.key}"`));
  if (req.auth.has(`${spec.module}.CREATE`) || req.auth.has(`${spec.module}.EDIT`)) return next();
  return next(
    ApiError.forbidden(`Importing ${spec.title} requires ${spec.module}.CREATE or ${spec.module}.EDIT`, {
      required: [`${spec.module}.CREATE`, `${spec.module}.EDIT`],
    }),
  );
};

export const template = asyncHandler(async (req, res) => {
  const body = importService.template(req.params.key);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.key}-import-template.csv"`);
  return res.send(body);
});

/**
 * Checks a file, and applies it unless this is a dry run.
 *
 * The file arrives either as an upload (`multipart/form-data`, field `file`) or
 * as text in a JSON body, because the screen dry-runs the same bytes it later
 * commits and re-uploading them a second time is a second chance for the two
 * to differ.
 */
export const runImport = asyncHandler(async (req, res) => {
  const csvText = req.file ? req.file.buffer.toString('utf8') : req.body?.csv;

  if (typeof csvText !== 'string' || csvText.trim() === '') {
    throw ApiError.badRequest('No file was sent. Choose a CSV file to import.', { field: 'file' });
  }

  const mode = req.body?.mode ?? 'upsert';
  if (!['create', 'update', 'upsert'].includes(mode)) {
    throw ApiError.badRequest('Mode must be "create", "update" or "upsert".', { field: 'mode' });
  }

  // A multipart field is a string; a JSON body sends a real boolean. Anything
  // that is not explicitly false is treated as a dry run, so the failure mode
  // of a malformed request is "nothing was written".
  const raw = req.body?.dryRun;
  const dryRun = !(raw === false || raw === 'false');

  const report = await importService.runImport(
    req.params.key,
    csvText,
    { mode, dryRun, has: (code) => req.auth.has(code) },
    actor(req),
  );

  return ok(res, report);
});
