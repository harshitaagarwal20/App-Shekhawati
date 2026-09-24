/**
 * The one CSV reader and the one CSV writer in this application.
 *
 * ===========================================================================
 *  WHY BOTH HALVES LIVE IN ONE FILE
 * ===========================================================================
 *
 *  A master export and a master import are the same table travelling in
 *  opposite directions, and the office uses them that way: export the buyers,
 *  fix forty phone numbers in Excel, import the file back. That round trip
 *  only holds if the writer and the reader agree, cell for cell, about what a
 *  quote, a comma and a line break inside a field mean. Two implementations in
 *  two files agree until one of them is fixed.
 *
 *  So: one escaper, one parser, one place to change.
 *
 * ---------------------------------------------------------------------------
 *  WHAT "CSV" MEANS HERE
 *
 *  RFC 4180, which is also what Excel writes:
 *
 *    - Fields are separated by commas, records by CRLF.
 *    - A field containing a comma, a quote or a line break is wrapped in
 *      double quotes.
 *    - A quote inside a quoted field is doubled ("" for one ").
 *
 *  Read back, a quoted field may contain newlines - which is why the parser
 *  below is a character scanner and not `text.split('\n').map(l => l.split(','))`.
 *  A vendor address with a line break in it is not exotic; it is the second
 *  row of every address column ever pasted out of a spreadsheet.
 * ---------------------------------------------------------------------------
 */

/**
 * A UTF-8 byte-order mark.
 *
 * Written at the head of every file this application produces, because without
 * it Excel opens the download in the system codepage and mangles any name with
 * an accent in it. Stripped again on the way in - see `parseCsv` - since Excel
 * writes one back.
 */
export const CSV_BOM = '\uFEFF';

/*
 * FORMULA INJECTION.
 *
 * Excel treats a cell starting with = + - @ (or a tab / CR) as a formula, so a
 * buyer contact saved as `=HYPERLINK(...)` would run when the export is opened.
 * Such a cell is written with a leading apostrophe, which Excel shows as text.
 *
 * Two exceptions keep ordinary data readable: a plain signed number
 * (`-1200.00`, a money column) and a phone number (`+91 98290 12345`). Neither
 * can hold a function call, so neither can do anything when evaluated.
 *
 * A value already starting with apostrophes before a trigger gains one more,
 * so `restoreFormulaCell` can take exactly one off and the import round trip
 * gives back what was exported.
 */
const FORMULA_START = /^'*[=+\-@\t\r]/;
const HARMLESS = /^[+-][\d\s().+-]*$/;

function neutraliseFormula(text) {
  return FORMULA_START.test(text) && !HARMLESS.test(text) ? `'${text}` : text;
}

/** The inverse of `neutraliseFormula`, applied to imported cells. */
export function restoreFormulaCell(text) {
  return text.startsWith("'") && FORMULA_START.test(text.slice(1)) && !HARMLESS.test(text.slice(1))
    ? text.slice(1)
    : text;
}

/** One cell, escaped only when it has to be. */
export function escapeCell(value) {
  const text = neutraliseFormula(value === null || value === undefined ? '' : String(value));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Rows -> CSV text.
 *
 * @param {{key: string, label: string}[]} columns
 * @param {object[]} rows
 * @returns {string} CRLF-separated, no BOM (the caller adds one if it is a file)
 */
export function toCsv(columns, rows) {
  const header = columns.map((c) => escapeCell(c.label ?? c.key)).join(',');
  const body = rows.map((row) => columns.map((c) => escapeCell(row[c.key])).join(','));
  return [header, ...body].join('\r\n');
}

/**
 * CSV text -> an array of rows, each an array of cells.
 *
 * Handles quoted fields, doubled quotes, embedded commas and embedded line
 * breaks, and accepts CRLF, LF or CR as the record separator - a file that has
 * been through Excel on Windows, a Mac and a text editor has often met all
 * three. A trailing newline does not produce a phantom empty row.
 *
 * Deliberately tolerant about ragged rows: a short row is padded and a long one
 * is kept whole. Deciding what a missing column MEANS is the importer's job,
 * and it can say so per row with a line number - which is more use than a
 * parser refusing the file with no idea which line was wrong.
 */
export function parseCsv(text) {
  const input = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let started = false; // this record has at least one character or delimiter

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
    started = false;
  };

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && field === '') {
      quoted = true;
      started = true;
    } else if (ch === ',') {
      endField();
      started = true;
    } else if (ch === '\r' || ch === '\n') {
      // CRLF is one separator, not two.
      if (ch === '\r' && input[i + 1] === '\n') i += 1;
      /*
       * A BLANK LINE STILL ENDS A RECORD.
       *
       * It is emitted as a row holding one empty field rather than skipped, so
       * that every row after it keeps the index the spreadsheet shows.
       * `parseCsvRecords` drops blank rows AFTER numbering them, which is the
       * only way "row 14" in an import report is the row 14 the user is
       * looking at.
       */
      endRow();
    } else {
      field += ch;
      started = true;
    }
  }

  // Whatever is left over is the last record, unless the file ended on a newline.
  if (started || field !== '' || row.length) endRow();

  return rows;
}

/**
 * Normalises a header cell so that "Buyer Code", "buyer_code" and "buyerCode"
 * are the same header.
 *
 * Case, spaces, underscores, hyphens and dots are all noise here: the person
 * editing the file is working in Excel, where a header is a caption, and
 * refusing their file over a capital letter would be the system being difficult
 * about something it can see perfectly well.
 */
export function normaliseHeader(text) {
  return String(text ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_.-]+/g, '');
}

/**
 * CSV text -> `{ headers, records }`, where each record carries the 1-based
 * line number of the row it came from.
 *
 * The line number is the whole point: an import report that says "row 14 is
 * missing a category" sends somebody straight to the cell, and one that says
 * "a row is missing a category" sends them through 900 of them. It counts
 * PARSED records rather than physical lines, so a quoted address spanning two
 * lines is still one numbered row - the same row Excel shows.
 */
export function parseCsvRecords(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return { headers: [], records: [] };

  const headers = rows[0].map((h) => String(h ?? '').trim());
  const records = [];

  for (let i = 1; i < rows.length; i += 1) {
    const cells = rows[i];
    // A row of nothing but empty cells is a spreadsheet artefact, not data.
    if (cells.every((c) => String(c ?? '').trim() === '')) continue;

    const values = {};
    headers.forEach((header, index) => {
      values[header] = restoreFormulaCell((cells[index] ?? '').trim());
    });
    // `line` is the row number a spreadsheet would show: 1 is the header.
    records.push({ line: i + 1, values });
  }

  return { headers, records };
}
