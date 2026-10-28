/**
 * The assistant's reference documents - upload, list, remove, and search.
 *
 * ===========================================================================
 *  FROM A FILE TO SOMETHING SEARCHABLE
 * ===========================================================================
 *
 *    1. READ     the text out of the file: every page of a PDF, or the whole
 *                of a .txt.
 *    2. CUT      it into overlapping chunks of a few sentences
 *                (domain/chunking.js).
 *    3. EMBED    each chunk into a vector of its meaning
 *                (embedding.service.js).
 *    4. STORE    the file, the chunks and their vectors in PostgreSQL, so they
 *                are all still there after a restart.
 *
 *  A question is then embedded the same way and compared with every chunk.
 *  The closest few go to Claude as the passages it may answer from.
 *
 * ===========================================================================
 *  WHY NOT A VECTOR DATABASE
 * ===========================================================================
 *
 *  A vector store - ChromaDB, or pgvector inside PostgreSQL - earns its keep
 *  at hundreds of thousands of chunks, where comparing a question with every
 *  one of them is too slow. A factory's tech packs and manuals are a few
 *  thousand chunks, which a plain loop compares in a few milliseconds. Keeping
 *  them in the database the ERP already has means one thing to back up, one
 *  thing to deploy, and no extension to install - pgvector would need building
 *  from source on the Windows machines this is developed on.
 *
 *  The chunks are held in memory once read, and re-read when the documents
 *  change - including when they change on another instance of the API, which
 *  the fingerprint in `index()` notices.
 *
 * ===========================================================================
 *  WHO MAY READ WHAT
 * ===========================================================================
 *
 *  A document may carry a `requiredPermission`. Its chunks are only ever
 *  searched for somebody holding that permission - so a costing workbook
 *  marked COST_SHEET.VIEW never reaches Claude on behalf of somebody who could
 *  not open a cost sheet on screen. The filter is applied before the search,
 *  not after: a chunk the caller may not see is never scored, never returned,
 *  and never sent.
 * ===========================================================================
 */

import path from 'node:path';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { MAX_BYTES } from './attachment.service.js';
import { chunkText } from '../domain/chunking.js';
import { embed, fromBytes, similarity, toBytes } from './embedding.service.js';

/** What may be uploaded, by extension. Generic types are accepted too - see attachment.service.js. */
export const ACCEPTED = {
  '.pdf': ['application/pdf'],
  '.txt': ['text/plain'],
};
const GENERIC_TYPES = ['application/octet-stream', ''];

/**
 * The permissions a document may be limited to - the registers whose figures
 * a reference document is likely to repeat. Offered as a dropdown on upload.
 */
export const DOCUMENT_PERMISSIONS = {
  'COST_SHEET.VIEW': 'Costing (cost sheets)',
  'BUYER_ORDER.VIEW': 'Buyer orders',
  'PURCHASE_ORDER.VIEW': 'Purchase orders',
  'VENDOR_QUOTATION.VIEW': 'Vendor quotations',
};

/**
 * A ceiling on one document's chunks. Ten MB of PDF is usually far less text
 * than this; a file that is more is a book, and embedding it would hold the
 * upload open for minutes.
 */
const MAX_CHUNKS = 3000;

/**
 * Below this similarity a chunk is not about the question, however near it is.
 *
 * Set low on purpose. Unrelated text scores near 0 (a tech pack against "the
 * price of diesel": 0.04), while the passage that answers a question can score
 * under 0.3 - a question is worded differently from the statement answering it.
 * A passage let through that does not help costs a few tokens, and Claude
 * leaves it uncited; a passage held back that would have helped turns into
 * "that is not in the documents". So the cut is only for the plainly
 * unrelated.
 */
export const MIN_SCORE = 0.15;

const LIST_SELECT = {
  id: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  pageCount: true,
  requiredPermission: true,
  uploadedByName: true,
  createdAt: true,
  _count: { select: { chunks: true } },
};

const visibleTo = (has) => (doc) => !doc.requiredPermission || has(doc.requiredPermission);

const listed = (doc) => {
  const { _count, ...rest } = doc;
  return { ...rest, chunkCount: _count.chunks };
};

// ===========================================================================
//  READING THE FILE
// ===========================================================================

/** The text of a file, one entry per page. */
async function pagesOf(file, ext) {
  if (ext === '.txt') {
    // Strip a byte-order mark; Notepad writes one.
    return { pages: [{ page: null, text: file.buffer.toString('utf8').replace(/^\uFEFF/, '') }], pageCount: null };
  }
  const { extractText, getDocumentProxy } = await import('unpdf');
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(file.buffer));
  } catch {
    throw ApiError.badRequest('That PDF could not be opened. It may be damaged or password-protected.', { field: 'file' });
  }
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  return { pages: text.map((t, i) => ({ page: i + 1, text: t })), pageCount: totalPages };
}

function checkFile(file) {
  if (!file) throw ApiError.badRequest('Choose a PDF or text file to upload.', { field: 'file' });
  const ext = path.extname(file.originalname ?? '').toLowerCase();
  const types = ACCEPTED[ext];
  if (!types) {
    throw ApiError.badRequest(`Only ${Object.keys(ACCEPTED).join(' and ')} files can be read by the assistant.`, {
      field: 'file',
    });
  }
  if (!types.includes(file.mimetype) && !GENERIC_TYPES.includes(file.mimetype ?? '')) {
    throw ApiError.badRequest(`That file says it is ${file.mimetype}, not a ${ext} file.`, { field: 'file' });
  }
  if (file.size > MAX_BYTES) {
    throw ApiError.badRequest(`That file is larger than the ${MAX_BYTES / 1024 / 1024} MB limit.`, { field: 'file' });
  }
  return ext;
}

// ===========================================================================
//  UPLOAD, LIST, OPEN, REMOVE
// ===========================================================================

export async function upload(file, { requiredPermission = null } = {}, actor) {
  const ext = checkFile(file);
  if (requiredPermission && !DOCUMENT_PERMISSIONS[requiredPermission]) {
    throw ApiError.badRequest('Choose who may read this document from the list.', { field: 'requiredPermission' });
  }

  const { pages, pageCount } = await pagesOf(file, ext);
  const chunks = chunkText(pages);
  if (!chunks.length) {
    throw ApiError.badRequest(
      ext === '.pdf'
        ? 'No text could be read from that PDF. It is probably a scan - run it through OCR first, or upload the text as a .txt file.'
        : 'That file is empty.',
      { field: 'file' },
    );
  }
  if (chunks.length > MAX_CHUNKS) {
    throw ApiError.badRequest(
      `That document is too long for the assistant (${chunks.length} passages; the limit is ${MAX_CHUNKS}). Split it into parts.`,
      { field: 'file' },
    );
  }

  const vectors = await embed(chunks.map((c) => c.text));

  const doc = await prisma.$transaction(async (tx) => {
    const created = await tx.assistantDocument.create({
      data: {
        fileName: file.originalname,
        mimeType: ACCEPTED[ext][0],
        sizeBytes: file.size,
        data: file.buffer,
        pageCount,
        requiredPermission,
        uploadedById: actor?.id ?? null,
        uploadedByName: actor?.fullName ?? null,
      },
      select: { id: true },
    });
    await tx.assistantChunk.createMany({
      data: chunks.map((c, i) => ({
        documentId: created.id,
        seq: c.seq,
        page: c.page,
        text: c.text,
        embedding: toBytes(vectors[i]),
      })),
    });
    return tx.assistantDocument.findUnique({ where: { id: created.id }, select: LIST_SELECT });
  });

  cache = null;
  return listed(doc);
}

/** The documents this caller may read. Metadata only - never the file. */
export async function list(has) {
  const docs = await prisma.assistantDocument.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: LIST_SELECT,
  });
  return docs.filter(visibleTo(has)).map(listed);
}

/** The original file, for the source link under an answer. */
export async function fetchFile(id, has) {
  const doc = await prisma.assistantDocument.findFirst({
    where: { id, deletedAt: null },
    select: { fileName: true, mimeType: true, data: true, requiredPermission: true },
  });
  // Not found and not allowed answer alike: whether a restricted document
  // exists is itself not for this caller.
  if (!doc || !visibleTo(has)(doc)) throw ApiError.notFound('Document');
  return doc;
}

/**
 * Soft-deletes the document, and hard-deletes its chunks: a removed document
 * must stop being searched at once, and its chunks are of no use to anybody
 * looking at the history.
 */
export async function remove(id, actor) {
  const doc = await prisma.assistantDocument.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!doc) throw ApiError.notFound('Document');
  await prisma.$transaction([
    prisma.assistantChunk.deleteMany({ where: { documentId: id } }),
    prisma.assistantDocument.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: actor?.id ?? null },
    }),
  ]);
  cache = null;
  return { id, removed: true };
}

// ===========================================================================
//  SEARCH
// ===========================================================================

/** Every live chunk with its vector, and the fingerprint it was read under. */
let cache = null;

/**
 * What changes when a document is added or removed on ANY instance. Cheaper
 * than re-reading the chunks, so it is checked on every search.
 */
async function fingerprint() {
  const [live, gone] = await Promise.all([
    prisma.assistantDocument.aggregate({ where: { deletedAt: null }, _count: { _all: true }, _max: { createdAt: true } }),
    prisma.assistantDocument.aggregate({ _max: { deletedAt: true } }),
  ]);
  return [live._count._all, live._max.createdAt?.toISOString(), gone._max.deletedAt?.toISOString()].join('|');
}

async function index() {
  const print = await fingerprint();
  if (cache?.print === print) return cache.chunks;

  const rows = await prisma.assistantChunk.findMany({
    where: { document: { deletedAt: null } },
    select: {
      id: true,
      seq: true,
      page: true,
      text: true,
      embedding: true,
      document: { select: { id: true, fileName: true, requiredPermission: true } },
    },
  });
  const chunks = rows.map((r) => ({
    id: r.id,
    seq: r.seq,
    page: r.page,
    text: r.text,
    vector: fromBytes(r.embedding),
    documentId: r.document.id,
    fileName: r.document.fileName,
    requiredPermission: r.document.requiredPermission,
  }));
  cache = { print, chunks };
  return chunks;
}

/**
 * The chunks nearest in meaning to `query` that this caller may read, best
 * first. Only those at least MIN_SCORE alike - so a question the documents do
 * not cover comes back empty, rather than with the least-bad passages.
 *
 * @returns {Promise<{ documents: number, results: Array<{documentId, fileName, page, seq, text, score}> }>}
 */
export async function search(query, has, { limit = 6 } = {}) {
  const visible = (await index()).filter(visibleTo(has));
  if (!visible.length) return { documents: 0, results: [] };

  const [q] = await embed([query]);
  const results = visible
    .map((c) => ({ chunk: c, score: similarity(q, c.vector) }))
    .filter((r) => r.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ chunk, score }) => ({
      documentId: chunk.documentId,
      fileName: chunk.fileName,
      page: chunk.page,
      seq: chunk.seq,
      text: chunk.text,
      score: Math.round(score * 1000) / 1000,
    }));

  return { documents: new Set(visible.map((c) => c.documentId)).size, results };
}
