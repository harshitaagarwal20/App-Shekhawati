/**
 * Sentence vectors for the assistant's document search.
 *
 * ===========================================================================
 *  WHAT AN EMBEDDING IS
 * ===========================================================================
 *
 *  all-MiniLM-L6-v2 turns a piece of text into 384 numbers - a point in a
 *  384-dimensional space - placed so that texts which MEAN the same thing land
 *  close together, whatever words they use. "How many pieces were stitched?"
 *  and "stitching output" are near; "the buyer wants red zips" is far from
 *  both. Searching is then measuring distance: the chunks nearest the question
 *  are the ones worth reading.
 *
 *  The vectors come back normalised to length 1, so the dot product of two of
 *  them IS their cosine similarity - 1 for the same meaning, around 0 for
 *  unrelated text.
 *
 * ===========================================================================
 *  RUNS HERE, NOT AT A PROVIDER
 * ===========================================================================
 *
 *  The model runs inside this process (transformers.js on onnxruntime), so a
 *  document's text is never sent anywhere to be embedded. It is downloaded
 *  from the Hugging Face hub on first use - about 90 MB - into
 *  ASSISTANT_MODEL_CACHE, and loaded from there after. The first upload or
 *  question after a start therefore waits a few seconds for the load, and the
 *  first one ever waits for the download.
 *
 *  Loaded lazily, once: a server that never sees the assistant never pays for
 *  it, and two requests arriving together share one load.
 * ===========================================================================
 */

import os from 'node:os';
import path from 'node:path';
import { env } from '../config/env.js';

export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const DIMENSIONS = 384;
/** Bytes in a stored vector: 384 float32 values. */
export const VECTOR_BYTES = DIMENSIONS * 4;

/** Texts embedded per call - bounds memory on a long document. */
const BATCH = 32;

let loading = null;

function extractor() {
  loading ??= (async () => {
    const { pipeline, env: hf } = await import('@huggingface/transformers');
    hf.cacheDir = env.ASSISTANT_MODEL_CACHE || path.join(os.tmpdir(), 'erp-assistant-model');
    return pipeline('feature-extraction', EMBEDDING_MODEL, { dtype: 'fp32' });
  })();
  // A failed load (no network for the first download) is retried next time,
  // rather than remembered as the answer for the life of the process.
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

/**
 * One normalised vector per text.
 *
 * @param {string[]} texts
 * @returns {Promise<Float32Array[]>}
 */
export async function embed(texts) {
  if (!texts.length) return [];
  const run = await extractor();
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const tensor = await run(texts.slice(i, i + BATCH), { pooling: 'mean', normalize: true });
    const flat = tensor.data;
    for (let j = 0; j < tensor.dims[0]; j += 1) {
      out.push(Float32Array.from(flat.subarray(j * DIMENSIONS, (j + 1) * DIMENSIONS)));
    }
  }
  return out;
}

/** A vector as stored: its float32 values, little-endian. */
export function toBytes(vector) {
  const buf = Buffer.alloc(VECTOR_BYTES);
  for (let i = 0; i < DIMENSIONS; i += 1) buf.writeFloatLE(vector[i], i * 4);
  return buf;
}

/** The stored bytes back into a vector. */
export function fromBytes(bytes) {
  const buf = Buffer.from(bytes);
  const vector = new Float32Array(DIMENSIONS);
  for (let i = 0; i < DIMENSIONS; i += 1) vector[i] = buf.readFloatLE(i * 4);
  return vector;
}

/** Cosine similarity of two normalised vectors. */
export function similarity(a, b) {
  let sum = 0;
  for (let i = 0; i < DIMENSIONS; i += 1) sum += a[i] * b[i];
  return sum;
}
