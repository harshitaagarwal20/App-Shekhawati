/**
 * Buyer order attachments.
 *
 * The download is the only handler in this application that does not answer
 * with the standard `{ success, data }` envelope: it answers with the file. A
 * browser asked to render a PDF wrapped in JSON renders nothing.
 */

import * as service from '../services/attachment.service.js';
import { asyncHandler, ok } from '../utils/http.js';

export const list = asyncHandler(async (req, res) =>
  ok(res, await service.list(req.params.id)),
);

export const create = asyncHandler(async (req, res) =>
  ok(
    res,
    await service.create(
      { buyerOrderId: req.params.id, file: req.file, note: req.body?.note },
      { id: req.auth.userId, fullName: req.auth.fullName },
    ),
    201,
  ),
);

export const download = asyncHandler(async (req, res) => {
  const file = await service.fetch(req.params.id, req.params.attachmentId);

  /*
   * Buffer.from, and res.end rather than res.send.
   *
   * Prisma hands a `Bytes` column back as a Uint8Array, which Express does not
   * recognise as a body: res.send() fell through to its JSON branch and
   * serialised the file as {"0":37,"1":80,...} - a 69-byte PDF left as 566
   * bytes of JSON with `charset=utf-8` appended to its content type. res.end()
   * writes the bytes and negotiates nothing.
   */
  const body = Buffer.from(file.data);

  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Length', body.length);
  /*
   * `inline`, so a measurement sheet opens in the viewer the browser already
   * has rather than landing in the downloads folder. The filename is still
   * given, so "save as" offers the right one.
   *
   * Quotes escaped and newlines stripped: a filename is user input and this
   * header is parsed, so a stray quote would let it be split into two.
   */
  const safe = file.fileName.replace(/["\\\r\n]/g, '_');
  res.setHeader('Content-Disposition', `inline; filename="${safe}"`);
  /* It is somebody's commercial document; no shared cache should keep it. */
  res.setHeader('Cache-Control', 'private, no-store');
  return res.end(body);
});

export const remove = asyncHandler(async (req, res) =>
  ok(res, await service.remove(req.params.id, req.params.attachmentId, req.auth.userId)),
);
