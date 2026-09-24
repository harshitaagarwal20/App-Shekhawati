/**
 * Buyer order attachments - in practice the buyer's measurement sheet.
 *
 * ===========================================================================
 *  THE BYTES ARE NEVER SELECTED BY ACCIDENT
 * ===========================================================================
 *
 *  `data` is a bytea column holding whole files. Prisma returns every scalar
 *  unless told otherwise, so a plain findMany() on this table would pull every
 *  attachment on the order into memory to render a list of filenames. Every
 *  read below therefore names its columns, and exactly one function - `fetch()`
 *  - asks for `data`.
 */

import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * What may be attached, keyed on the EXTENSION.
 *
 * An allowlist rather than a blocklist: the question "is this dangerous" has
 * no end, and the question "is this a measurement sheet" has a short answer.
 *
 * ---------------------------------------------------------------------------
 *  WHY THE EXTENSION LEADS AND THE MIME TYPE FOLLOWS
 *
 *  This used to be keyed on the browser's declared MIME type, with the
 *  extension required to agree. That works for PDFs and images, which every
 *  browser labels correctly, and breaks for spreadsheets: Windows reads the
 *  type for .xlsx out of the registry, so a machine WITHOUT Excel installed
 *  uploads a perfectly good workbook labelled `application/octet-stream` and
 *  the old check refused it - on the one class of machine, the shop floor PC,
 *  most likely to be sending one.
 *
 *  So the extension decides what the file claims to be, and the declared type
 *  has to be either the right one for that extension or an honestly generic
 *  one. Neither is proof of anything: both come from the uploader, and this is
 *  a check that the file is the KIND of thing this screen is for, not a
 *  security boundary. What keeps a hostile upload harmless is that the bytes
 *  go into a bytea column, are never executed, and come back out under their
 *  stored type - none of which this list affects.
 * ---------------------------------------------------------------------------
 */
export const ACCEPTED = {
  '.pdf': ['application/pdf'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.webp': ['image/webp'],
  /*
   * Excel. `.xlsx` is a zip underneath, which is why some browsers call it
   * `application/x-zip-compressed` - accepted here for that extension only,
   * so a plain .zip is still refused.
   */
  '.xlsx': [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/x-zip-compressed',
    'application/zip',
  ],
  '.xls': ['application/vnd.ms-excel'],
};

/**
 * Types that mean "I do not know", accepted alongside the right one.
 *
 * A browser that cannot name the type says so with octet-stream, or says
 * nothing at all. Refusing those refuses the file for the browser's ignorance
 * rather than for anything about the file.
 */
const GENERIC_TYPES = ['application/octet-stream', 'application/download', ''];

/** For the error message and the file picker: ".pdf, .jpg, ... or .xls". */
const ACCEPTED_EXTENSIONS = Object.keys(ACCEPTED);

/** 10 MB. A scanned measurement sheet is a few hundred KB; this is generous. */
export const MAX_BYTES = 10 * 1024 * 1024;

/** Metadata only - never the file. */
const LIST_SELECT = {
  id: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  note: true,
  uploadedByName: true,
  createdAt: true,
};

/**
 * The opening bytes every file of each accepted kind starts with.
 *
 * The extension and the declared type are both the uploader's word; these
 * bytes are the file's own. A web page renamed to .pdf passed the two checks
 * above and was stored as a "PDF".
 */
const SIGNATURES = {
  // PDF readers accept the header anywhere in the first 1 KB.
  '.pdf': (b) => b.subarray(0, 1024).includes('%PDF-'),
  '.jpg': (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  '.jpeg': (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  '.png': (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  '.webp': (b) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
  // .xlsx is a zip archive.
  '.xlsx': (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]),
  // .xls is an OLE compound document.
  '.xls': (b) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
};

function startsWith(buffer, bytes) {
  return buffer.length >= bytes.length && bytes.every((byte, i) => buffer[i] === byte);
}

function hasSignatureOf(ext, buffer) {
  const check = SIGNATURES[ext];
  return Boolean(check && buffer && check(Buffer.from(buffer)));
}

function extensionOf(name) {
  const i = String(name ?? '').lastIndexOf('.');
  return i === -1 ? '' : name.slice(i).toLowerCase();
}

/** The order must exist before anything is hung off it. */
async function assertOrder(buyerOrderId) {
  const order = await prisma.buyerOrder.findFirst({
    where: { id: buyerOrderId, deletedAt: null },
    select: { id: true, orderNo: true },
  });
  if (!order) throw ApiError.notFound('Buyer order');
  return order;
}

export async function list(buyerOrderId) {
  await assertOrder(buyerOrderId);
  return prisma.buyerOrderAttachment.findMany({
    where: { buyerOrderId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: LIST_SELECT,
  });
}

/** The one read that pulls the file. */
export async function fetch(buyerOrderId, id) {
  const row = await prisma.buyerOrderAttachment.findFirst({
    where: { id, buyerOrderId, deletedAt: null },
    select: { fileName: true, mimeType: true, sizeBytes: true, data: true },
  });
  if (!row) throw ApiError.notFound('Attachment');
  return row;
}

export async function create({ buyerOrderId, file, note }, actor) {
  await assertOrder(buyerOrderId);

  if (!file) {
    throw ApiError.badRequest('No file was uploaded.', { field: 'file' });
  }

  const ext = extensionOf(file.originalname);
  const allowedTypes = ACCEPTED[ext];
  if (!allowedTypes) {
    throw ApiError.badRequest(
      `"${file.originalname}" is not an accepted kind of file. Attach a PDF, an `
        + 'image (JPEG, PNG or WebP) or an Excel workbook (.xlsx or .xls).',
      { field: 'file', received: ext || '(no extension)', allowed: ACCEPTED_EXTENSIONS },
    );
  }

  /*
   * The declared type is the uploader's word for it, so it only has to not
   * CONTRADICT the extension. A browser that does not know the type says
   * octet-stream, which contradicts nothing.
   */
  const declared = String(file.mimetype ?? '').toLowerCase();
  if (!allowedTypes.includes(declared) && !GENERIC_TYPES.includes(declared)) {
    throw ApiError.badRequest(
      `"${file.originalname}" ends in ${ext} but was sent as ${file.mimetype}. `
        + `A ${ext} should arrive as ${allowedTypes[0]}.`,
      { field: 'file', received: file.mimetype, expected: allowedTypes },
    );
  }

  if (!file.size) {
    throw ApiError.badRequest('That file is empty.', { field: 'file' });
  }
  if (file.size > MAX_BYTES) {
    throw ApiError.badRequest(
      `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is `
        + `${MAX_BYTES / 1024 / 1024} MB.`,
      { field: 'file' },
    );
  }

  if (!hasSignatureOf(ext, file.buffer)) {
    throw ApiError.badRequest(
      `"${file.originalname}" ends in ${ext} but its contents are not a ${ext} file. `
        + 'It may be damaged, or renamed from another kind of file. Open it and save it again as '
        + `${ext}, then attach that copy.`,
      { field: 'file', received: ext },
    );
  }

  const row = await prisma.buyerOrderAttachment.create({
    data: {
      buyerOrderId,
      fileName: file.originalname.slice(0, 255),
      mimeType: file.mimetype,
      sizeBytes: file.size,
      note: note || null,
      data: file.buffer,
      uploadedById: actor?.id ?? null,
      uploadedByName: actor?.fullName ?? null,
    },
    select: LIST_SELECT,
  });
  return row;
}

/**
 * Soft delete, like everything else that carries provenance.
 *
 * The bytes stay. An attachment is evidence of what an order was based on, and
 * "somebody removed it" is a different fact from "it was never there".
 */
export async function remove(buyerOrderId, id, actorId) {
  const existing = await prisma.buyerOrderAttachment.findFirst({
    where: { id, buyerOrderId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) throw ApiError.notFound('Attachment');

  await prisma.buyerOrderAttachment.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: actorId ?? null },
  });
  return { id };
}
