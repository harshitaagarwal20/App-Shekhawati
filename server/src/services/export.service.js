/**
 * "Download this table" - for every table in the application.
 *
 * ===========================================================================
 *  THE EXPORT IS THE SCREEN, UNPAGED
 * ===========================================================================
 *
 *  Each dataset in dataset.registry.js names the SAME `list()` its own screen
 *  calls, and this runner hands it the SAME filters the screen was showing.
 *  The only difference is that it keeps asking for the next page until there
 *  are no more - so an export can differ from the screen in length and in
 *  nothing else.
 *
 *  That is a stronger guarantee than it sounds. The obvious alternative - a
 *  second query written for the export - is a second reading of the business
 *  rules: which rows are soft-deleted, which are in scope for this filter,
 *  which figure a column actually holds. The two agree on the day they are
 *  written and then drift, and the drift is discovered months later by
 *  somebody reconciling a spreadsheet against the workbook.
 *
 * ---------------------------------------------------------------------------
 *  WHY THE COLUMNS ARE MOSTLY DERIVED
 *
 *  A hand-written column list per table is the same drift in another place:
 *  add a column to a list projection and the screen gains it while the export
 *  quietly does not. So unless a dataset declares its columns - the record
 *  masters do, because their export doubles as their import template - the
 *  columns are read off the rows that came back. An export therefore carries
 *  the whole row by construction.
 *
 *  What is left OUT is a short, deliberate list: internal ids, the soft-delete
 *  bookkeeping, and whatever the dataset names in `hide` (a user's password
 *  hash, the audit trail's JSON snapshots). See `HIDDEN` below.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';
import { ApiError } from '../utils/ApiError.js';
import { CSV_BOM, toCsv } from '../utils/csv.js';
import { allDatasets, datasetFor, filterKeysOf } from './dataset.registry.js';

/**
 * The most rows one export will produce.
 *
 * A ceiling rather than a silent truncation: past this the request is REFUSED
 * and names the number, because a spreadsheet that quietly stops at row 50,000
 * is a spreadsheet somebody reconciles against and finds short. Every screen
 * that can reach this many rows has date filters; the message says so.
 */
export const MAX_EXPORT_ROWS = 50_000;

/** Rows per round trip to the service. Large enough to be few, small enough to page. */
const CHUNK = 500;

/**
 * Never exported, whatever a projection grows.
 *
 * Internal identifiers and soft-delete bookkeeping. They are not secret - the
 * API returns them - but a spreadsheet full of UUID columns is harder to read
 * and nobody has ever wanted one. Datasets add their own exclusions with
 * `hide`.
 */
const HIDDEN = new Set([
  'id',
  'deletedAt',
  'deletedById',
  'createdById',
  'updatedById',
  '_count',
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The reports catalogue, but for tables: what this user may download. */
export function catalogue(has) {
  return allDatasets()
    .filter((d) => has(`${d.module}.EXPORT`))
    .map((d) => ({
      key: d.key,
      title: d.title,
      group: d.group,
      module: d.module,
      filters: filterKeysOf(d),
    }));
}

/** The dataset, or a 404 - never a silent empty file. */
export function descriptorFor(key) {
  const dataset = datasetFor(key);
  if (!dataset) throw ApiError.notFound(`Export "${key}"`);
  return dataset;
}

// ===========================================================================
//  READING THE ROWS
// ===========================================================================

/**
 * The query the service gets, built from the request the same way
 * `parseListQuery` builds it for the screen - minus the paging, which this
 * runner drives itself.
 *
 * Only the keys the dataset DECLARES are passed through. Anything else in the
 * query string is dropped, so a caller cannot reach a filter the screen has no
 * equivalent of by guessing its name.
 */
function baseQuery(dataset, query) {
  const allowed = filterKeysOf(dataset);
  const filters = {};
  for (const key of allowed) {
    const value = query[key];
    if (value === undefined || value === null || value === '') continue;
    filters[key] = value;
  }

  const sortBy = dataset.sortable?.includes(query.sortBy) ? query.sortBy : dataset.defaultSort;
  const sortDir = query.sortDir === 'desc' || query.sortDir === 'asc' ? query.sortDir : (dataset.defaultDir ?? 'asc');

  return {
    ...filters,
    search: typeof query.search === 'string' ? query.search.trim() : '',
    includeDeleted: query.includeDeleted === true || query.includeDeleted === 'true',
    orderBy: sortBy ? { [sortBy]: sortDir } : undefined,
    sortBy,
    sortDir,
  };
}

/** Pages through the dataset's own list() until it runs out. */
async function readAll(dataset, query) {
  const base = baseQuery(dataset, query);
  const rows = [];
  let page = 1;
  let total = 0;

  for (;;) {
    // Sequential by nature: page 2 cannot be asked for until page 1 is back.
    const result = await dataset.fetch({
      ...base,
      page,
      pageSize: CHUNK,
      skip: (page - 1) * CHUNK,
      take: CHUNK,
    });

    total = result.total ?? result.rows.length;

    if (page === 1 && total > MAX_EXPORT_ROWS) {
      throw ApiError.badRequest(
        `This export would be ${total.toLocaleString('en-IN')} rows, and ${MAX_EXPORT_ROWS.toLocaleString('en-IN')} `
          + 'is the most one file will carry. Narrow it with the filters on the screen - a date range '
          + 'is usually enough - and download it in parts.',
        { total, limit: MAX_EXPORT_ROWS },
      );
    }

    rows.push(...result.rows);

    // A service that ignores paging (the stock balance sorts and pages itself)
    // returns everything on the first call; the row count says so.
    if (result.rows.length < CHUNK || rows.length >= total) break;
    page += 1;
  }

  return { rows, total };
}

// ===========================================================================
//  COLUMNS AND CELLS
// ===========================================================================

/** `notifyPartyName` -> `Notify Party Name`; `buyer.buyerCode` -> `Buyer Code`. */
function humanise(path) {
  const last = path.split('.').pop();
  const words = last
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Reads `buyer.buyerCode` out of a row. */
export function valueAt(row, path) {
  return path.split('.').reduce((acc, part) => (acc === null || acc === undefined ? acc : acc[part]), row);
}

const isPlainObject = (v) =>
  v !== null
  && typeof v === 'object'
  && !Array.isArray(v)
  && !(v instanceof Date)
  && !Prisma.Decimal.isDecimal(v);

/**
 * The columns for a set of rows.
 *
 * Nested records are flattened ONE level - `buyer.buyerName` becomes a column,
 * because that is how a related record reads in a spreadsheet and a JSON blob
 * in a cell does not. Deeper than that, and arrays of records, are summarised
 * rather than expanded: a column per BOM line would give every export a
 * different shape.
 *
 * ---------------------------------------------------------------------------
 *  WHY THIS IS TWO PASSES AND NOT ONE
 *
 *  Both decisions this makes need to see EVERY row before they can be made,
 *  and making them off the first row alone gets them wrong in ways that are
 *  quiet:
 *
 *    WHETHER A `...Id` COLUMN IS AN INTERNAL UUID. `rollId` is null on a
 *    ledger entry that is not roll-tracked. Judged on row 1, where it happens
 *    to be null, it does not look like a UUID - so the column was kept, and
 *    the export grew a wall of identifiers nobody can read. Judged over the
 *    whole set, one UUID anywhere in the column settles it.
 *
 *    WHETHER A COLUMN IS A COUNT. An array of records has to be summarised,
 *    and a bare "12" under a heading that reads "Permissions" is a figure that
 *    looks like data. Knowing that the column IS a count is what lets the
 *    header say so.
 *
 *  Keys are collected across all rows in first-seen order for the same reason:
 *  a projection can leave an empty relation off a row entirely, and a column
 *  that exists for row 2 and not for row 1 must still be in the header.
 * ---------------------------------------------------------------------------
 */
function deriveColumns(rows, hide = []) {
  const skip = new Set([...HIDDEN, ...hide]);

  /** path -> what was seen at it across every row, in first-seen order. */
  const observed = new Map();

  const note = (path, value) => {
    const seen = observed.get(path) ?? { isUuid: false, isRecordList: false, isRecord: false };
    if (typeof value === 'string' && UUID.test(value)) seen.isUuid = true;
    if (Array.isArray(value) && value.some(isPlainObject)) seen.isRecordList = true;
    if (isPlainObject(value)) seen.isRecord = true;
    observed.set(path, seen);
  };

  for (const row of rows) {
    if (!isPlainObject(row)) continue;
    for (const [key, value] of Object.entries(row)) {
      if (skip.has(key)) continue;

      note(key, value);

      if (isPlainObject(value)) {
        for (const [sub, subValue] of Object.entries(value)) {
          if (skip.has(sub)) continue;
          if (isPlainObject(subValue) || Array.isArray(subValue)) continue; // one level, no deeper
          note(`${key}.${sub}`, subValue);
        }
      }
    }
  }

  const columns = [];
  for (const [path, seen] of observed) {
    const key = path.split('.').pop();

    /*
     * A NULLABLE RELATION IS ITS FLATTENED COLUMNS, NOT BOTH.
     *
     * A ledger entry that is not roll-tracked carries `roll: null`, and one
     * that is carries the whole record. Noting both means the path `roll` is
     * seen as a scalar on some rows and as a record on others - and keeping it
     * alongside `roll.rollNo` gives the file a junk column of JSON beside the
     * readable one. Where a path was EVER a record, its flattened children are
     * the columns and the path itself is not.
     */
    if (seen.isRecord) continue;

    // Internal identifiers. A UUID anywhere in the column settles it; a
    // `...ById` is an actor id whatever it holds, and every projection that
    // carries one carries the matching `...ByName` beside it.
    if (/ById$/.test(key)) continue;
    if ((key === 'id' || /Id$/.test(key)) && seen.isUuid) continue;

    columns.push({
      key: path,
      label: seen.isRecordList ? `${humanise(path)} (count)` : humanise(path),
    });
  }

  return columns;
}

/**
 * One value, as a spreadsheet should read it.
 *
 * The two that matter: a Prisma Decimal is stringified rather than turned into
 * a JavaScript number, because every quantity and money column in this schema
 * is Decimal(18,4) and a float round trip is exactly how a reconciliation ends
 * up out by a paisa; and a date-only timestamp is written as YYYY-MM-DD, which
 * Excel reads as a date, rather than as an ISO string with a midnight on the
 * end that it reads as text.
 */
export function formatCell(value) {
  if (value === null || value === undefined) return '';
  if (Prisma.Decimal.isDecimal(value)) return value.toString();
  if (value instanceof Date) {
    const iso = value.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    /*
     * A list of PLAIN values is written out - a role's permission codes are
     * the useful thing about a role, and "9" is not. A list of RECORDS is
     * counted, because a bill of materials does not fit in a cell; the header
     * says "(count)" so the figure cannot be mistaken for data. See
     * deriveColumns.
     */
    return value.some((v) => v !== null && typeof v === 'object')
      ? String(value.length)
      : value.map((v) => formatCell(v)).join('; ');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// ===========================================================================
//  THE RUN
// ===========================================================================

/**
 * Runs one export.
 *
 * @param {string} key    A dataset key from the registry
 * @param {object} query  The screen's query string
 * @returns {{key:string, title:string, columns:{key:string,label:string}[], rows:object[], total:number}}
 */
export async function runExport(key, query = {}) {
  const dataset = descriptorFor(key);
  const { rows, total } = await readAll(dataset, query);

  const columns = dataset.columns ?? deriveColumns(rows, dataset.hide);

  return {
    key: dataset.key,
    title: dataset.title,
    columns,
    rows: rows.map((row) => {
      const flat = {};
      for (const column of columns) flat[column.key] = formatCell(valueAt(row, column.key));
      return flat;
    }),
    total,
  };
}

/** The finished export as the bytes of a file, BOM and all. */
export function toCsvFile(result) {
  return CSV_BOM + toCsv(result.columns, result.rows);
}

/** `buyers-2026-09-04.csv` */
export function fileNameFor(result) {
  return `${result.key}-${new Date().toISOString().slice(0, 10)}.csv`;
}
