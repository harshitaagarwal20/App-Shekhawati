/**
 * Tables out, masters in.
 *
 *   GET  /api/exports                   the tables this user may download
 *   GET  /api/exports/:key/csv          one of them, filtered as the screen was
 *
 *   GET  /api/imports                   the masters this user may import
 *   GET  /api/imports/:key              its columns, which are required, and why
 *   GET  /api/imports/:key/template     a blank file with just the header row
 *   POST /api/imports/:key              check a file, and apply it unless dryRun
 *
 * ---------------------------------------------------------------------------
 *  PERMISSION IS NOT ON THE ROUTE, AND THAT IS THE POINT
 *
 *  One route serves every table, so a fixed permission guard here would have to
 *  name a module - and with the module coming from the URL, that is a
 *  permission the CALLER chose. Both checks below therefore read the module
 *  from the registry entry the key resolves to. See the controller.
 *
 *  (Which is also why no `can(...)` call appears in this file, and why the RBAC
 *  route audit in test/rbac.rules.test.js finds none here. It scans these files
 *  for guards, so an illustrative one written in a comment would read to it as
 *  a real route demanding a permission that does not exist.)
 *
 *  The import goes further: the route can only establish that you may import
 *  this master AT ALL. Whether the file needs CREATE, EDIT or both is decided
 *  after it has been parsed, because that is the first moment anyone knows.
 * ---------------------------------------------------------------------------
 */

import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import validate from '../middleware/validate.js';
import * as c from '../controllers/dataTransfer.controller.js';
import { ApiError } from '../utils/ApiError.js';

const keyParam = z.object({ key: z.string().trim().min(1).max(60) });

// ===========================================================================
//  EXPORT
// ===========================================================================

export const exportRoutes = Router();

exportRoutes.get('/', c.catalogue);

/*
 * No `validate({ query })`. Every dataset has its own filters and the runner
 * already passes through ONLY the keys its registry entry declares - anything
 * else in the query string is dropped rather than reaching a service. A schema
 * here would be a second, weaker copy of that allow-list.
 */
exportRoutes.get('/:key/csv', validate({ params: keyParam }), c.requireExportPermission, c.csv);

// ===========================================================================
//  IMPORT
// ===========================================================================

export const importRoutes = Router();

/** 5 MB. A 5,000-row master CSV is well under a megabyte; this is generous. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/*
 * Memory storage: the file's destination is a parser, not a disk. Writing it
 * to a temp directory would only add a file to clean up and a failure mode
 * where the import succeeds and the temp file stays.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

/** Multer's own failures, said in words rather than as a bare 500. */
const receiveFile = (req, res, next) =>
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const said = {
        LIMIT_FILE_SIZE: `That file is larger than the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit.`,
        LIMIT_FILE_COUNT: 'Import one file at a time.',
        LIMIT_UNEXPECTED_FILE: 'The upload field must be named "file".',
      }[err.code];
      return next(ApiError.badRequest(said ?? `Upload failed: ${err.code}`, { field: 'file' }));
    }
    return next(err);
  });

importRoutes.get('/', c.importCatalogue);

importRoutes.get('/:key', validate({ params: keyParam }), c.requireImportPermission, c.importFields);

importRoutes.get(
  '/:key/template',
  validate({ params: keyParam }),
  c.requireImportPermission,
  c.template,
);

/* `receiveFile` runs before the handler: a multipart body does not exist as
   fields until multer has parsed it. */
importRoutes.post(
  '/:key',
  validate({ params: keyParam }),
  c.requireImportPermission,
  receiveFile,
  c.runImport,
);
