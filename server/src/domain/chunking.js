/**
 * Cutting a document's text into overlapping chunks for the assistant.
 *
 * ===========================================================================
 *  WHY CHUNKS, AND WHY THEY OVERLAP
 * ===========================================================================
 *
 *  A search finds the passage closest in meaning to a question. A whole tech
 *  pack is a poor "passage" - it is about everything at once - so the text is
 *  cut into pieces of a few sentences each, and each piece is searched alone.
 *
 *  The pieces overlap so a fact that straddles a cut is still whole in one of
 *  them: the last sentences of each chunk are repeated at the start of the
 *  next. Without that, "Zip: YKK #5, colour 1910" at the foot of one chunk and
 *  "on the front pocket only" at the head of the next would never be found
 *  together.
 *
 *  THE SIZE. Small. A chunk's vector is the average meaning of everything in
 *  it, so a chunk covering the zip, the label and the handles is a little like
 *  all three and close to none: a question about the handles scores it low.
 *  all-MiniLM-L6-v2 is trained on sentences and short paragraphs, and a few
 *  sentences - 500 characters - is where it is sharpest. (It also reads at most
 *  256 word pieces and ignores the rest, which 500 characters stays well
 *  inside.)
 *
 *  Cuts fall between lines and sentences, never inside one, unless a single
 *  line is longer than a chunk - a table row run together by the PDF - which is
 *  then cut between words. A chunk never crosses a page, so the page a source
 *  names is the page the passage is on.
 * ===========================================================================
 */

export const CHUNK_CHARS = 500;
export const OVERLAP_CHARS = 120;

/** Collapses runs of spaces and tabs, and trims every line. */
function tidy(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n');
}

/** A line longer than `max`, cut between words into pieces no longer than it. */
function cutLong(line, max) {
  const out = [];
  let piece = '';
  for (const word of line.split(' ')) {
    // A single "word" longer than a chunk (a URL, a run of dashes) is cut
    // where it has to be.
    for (let w = word; w.length; w = w.slice(max)) {
      const part = w.slice(0, max);
      if (piece && piece.length + 1 + part.length > max) {
        out.push(piece);
        piece = part;
      } else {
        piece = piece ? `${piece} ${part}` : part;
      }
    }
  }
  if (piece) out.push(piece);
  return out;
}

/**
 * One page's text as a list of sentences and lines. `sep` is what joins a unit
 * to the one before it: a newline where the document had one, so a spec
 * sheet's rows stay rows.
 */
function unitsOf(text, max) {
  const units = [];
  for (const line of tidy(text).split('\n')) {
    if (!line) continue;
    const sentences = line.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/);
    sentences.forEach((sentence, i) => {
      for (const [j, part] of cutLong(sentence, max).entries()) {
        units.push({ text: part, sep: i === 0 && j === 0 ? '\n' : ' ' });
      }
    });
  }
  return units;
}

/**
 * The chunks of a document, page by page, numbered through the whole of it.
 *
 * @param {Array<{ page?: number|null, text: string }>} pages  one entry per PDF
 *        page, or a single entry with no page for a text file
 * @returns {Array<{ seq: number, page: number|null, text: string }>}
 */
export function chunkText(pages, { size = CHUNK_CHARS, overlap = OVERLAP_CHARS } = {}) {
  const chunks = [];
  for (const { page = null, text } of pages) {
    for (const piece of packUnits(unitsOf(text, size), size, overlap)) {
      chunks.push({ seq: chunks.length, page, text: piece });
    }
  }
  return chunks;
}

/** Units packed greedily into overlapping chunks of at most `size` characters. */
function packUnits(units, size, overlap) {
  const chunks = [];
  let start = 0;

  while (start < units.length) {
    // Take units until the next would overflow the chunk. Always at least one.
    let end = start;
    let length = 0;
    while (end < units.length) {
      const add = (end === start ? 0 : 1) + units[end].text.length;
      if (end > start && length + add > size) break;
      length += add;
      end += 1;
    }

    const text = units
      .slice(start, end)
      .map((u, i) => (i === 0 ? u.text : u.sep + u.text))
      .join('');
    chunks.push(text);
    if (end >= units.length) break;

    // Step back over the last units, up to `overlap` characters, so the next
    // chunk opens with them. Never back to `start` itself - that would repeat
    // the same chunk for ever.
    let next = end;
    let carried = 0;
    while (next - 1 > start && carried + units[next - 1].text.length <= overlap) {
      next -= 1;
      carried += units[next].text.length + 1;
    }
    start = next;
  }

  return chunks;
}
