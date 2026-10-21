/**
 * One uploaded file, field "file", held in memory.
 *
 * MEMORY STORAGE, DELIBERATELY.
 *
 * The file's destination is a bytea column, so writing it to a temp directory
 * first would only add a file to clean up and a failure mode where the row is
 * written and the temp file is not removed. `limits.fileSize` is the real
 * guard - it aborts the request mid-stream rather than buffering 500 MB to
 * discover it is too big - and the service checks the size again on the way
 * in, because a limit enforced in one place is a limit that moves when the
 * upload route does.
 *
 * Shared by the buyer order's measurement sheets and External QC's inspection
 * reports. It runs before `validate`: the body is multipart and does not exist
 * as fields until multer has parsed it.
 */

import multer from 'multer';
import { MAX_BYTES } from '../services/attachment.service.js';
import { ApiError } from '../utils/ApiError.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
});

/**
 * Multer's own failures, said in words.
 *
 * A MulterError carries a `code` and no status, so it would fall through the
 * error handler to a bare 500 - "the ERP is broken" for what is really "that
 * file is too big". The limit is stated in the message because a refusal that
 * does not say the ceiling leaves the user to find it by bisection.
 */
export const receiveFile = (req, res, next) =>
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const said = {
        LIMIT_FILE_SIZE: `That file is larger than the ${MAX_BYTES / 1024 / 1024} MB limit.`,
        LIMIT_FILE_COUNT: 'Attach one file at a time.',
        LIMIT_UNEXPECTED_FILE: 'The upload field must be named "file".',
      }[err.code];
      return next(ApiError.badRequest(said ?? `Upload failed: ${err.code}`, { field: 'file' }));
    }
    return next(err);
  });

export default receiveFile;
