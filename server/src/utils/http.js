/**
 * Small HTTP helpers shared by every controller: a uniform response envelope,
 * an async wrapper so controllers can just `throw`, and the list-query parser
 * that gives every master and transaction screen the same
 * search / filter / sort / paginate behaviour.
 */

/** Wraps an async controller so a rejected promise reaches the error handler. */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/** `{ success: true, data }` - the single success shape for the whole API. */
export function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

/**
 * The paging block every list response carries.
 *
 * One function so `okList` and `okListWithTotals` cannot drift on what
 * `pageCount` or `hasNext` mean - the client's Pagination component reads
 * these on every screen and has to be able to trust one definition.
 */
function pageMeta({ total, page, pageSize }) {
  return {
    total,
    page,
    pageSize,
    pageCount: pageSize > 0 ? Math.ceil(total / pageSize) : 0,
    hasNext: page * pageSize < total,
    hasPrev: page > 1,
  };
}

/** Paginated list response. */
export function okList(res, { rows, total, page, pageSize }) {
  return res.status(200).json({
    success: true,
    data: rows,
    meta: pageMeta({ total, page, pageSize }),
  });
}

/**
 * `okList` plus a `totals` block, for the lists that carry column totals.
 *
 * ---------------------------------------------------------------------------
 *  THE TOTALS DESCRIBE THE FILTER, NOT THE PAGE
 *
 *  Every service that fills this in computes its totals over the whole
 *  filtered set - by aggregate, not by adding up the rows it just returned.
 *  That distinction is the whole reason the block is separate from `data`:
 *  a "Stock value" or a "Total issued" that quietly meant "of the twenty-five
 *  lines on screen" would be wrong by however many pages there are, and
 *  nothing about the number would say so.
 *
 *  If you add a caller, compute its totals the same way.
 * ---------------------------------------------------------------------------
 */
export function okListWithTotals(res, { rows, total, page, pageSize, totals }) {
  return res.status(200).json({
    success: true,
    data: rows,
    meta: { ...pageMeta({ total, page, pageSize }), totals },
  });
}

export const MAX_PAGE_SIZE = 200;

/**
 * The most rows any `options()` endpoint will return.
 *
 * ---------------------------------------------------------------------------
 *  WHY A DROPDOWN NEEDS A CEILING
 *
 *  Every `options()` in this application feeds a `<select>`, and every one of
 *  them was unbounded - `findMany` with a filter and an `orderBy` and no
 *  `take`. That is fine while a buyer has seven styles and the store has eight
 *  items, and it stops being fine quietly: the first symptom is a form that
 *  takes four seconds to open because it is building three thousand `<option>`
 *  elements, and by then it is on every screen that has a dropdown.
 *
 *  This is a safety ceiling, not a page size. A dropdown is not paged - there
 *  is nowhere in a `<select>` to put a "next page" - so the right fix at that
 *  scale is a typeahead that queries as you type. The ceiling is what stops an
 *  unbounded read in the meantime, and it is set high enough that no realistic
 *  list in this business reaches it.
 * ---------------------------------------------------------------------------
 */
export const OPTIONS_LIMIT = 500;

/**
 * Parses the common list query string.
 *
 *   ?page=1&pageSize=25&search=tote&sortBy=buyerName&sortDir=asc
 *   &status=ACTIVE&includeDeleted=false
 *
 * `sortBy` is checked against an allow-list by the caller, never passed
 * through to Prisma unvalidated.
 *
 * @param {import('express').Request} req
 * @param {object} opts
 * @param {string[]} opts.sortable    Field names that may be sorted on
 * @param {string}   opts.defaultSort Default sort field
 * @param {'asc'|'desc'} [opts.defaultDir]
 */
export function parseListQuery(req, { sortable, defaultSort, defaultDir = 'asc' }) {
  const q = req.query;

  const page = Math.max(1, Number.parseInt(q.page, 10) || 1);
  const rawSize = Number.parseInt(q.pageSize, 10);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.isFinite(rawSize) ? rawSize : 25));

  const sortBy = sortable.includes(q.sortBy) ? q.sortBy : defaultSort;
  const sortDir = q.sortDir === 'desc' || q.sortDir === 'asc' ? q.sortDir : defaultDir;

  const search = typeof q.search === 'string' ? q.search.trim() : '';

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
    orderBy: { [sortBy]: sortDir },
    search,
    sortBy,
    sortDir,
    includeDeleted: q.includeDeleted === 'true',
  };
}

/**
 * Case-insensitive "contains" across several columns.
 *
 * A field may be a column on the model - `'orderNo'` - or a dotted path into a
 * RELATION the list already joins, `'order.orderNo'`, which becomes the nested
 * `{ order: { orderNo: { contains } } }` Prisma wants.
 *
 * The dotted form exists because a register that DISPLAYS a column from a
 * joined record is a register somebody will type that column into the search
 * box: the plan approval list shows each round's order number, and searching
 * it matched nothing at all, because the search could only see the approval's
 * own columns. A search that silently cannot see half of what is on screen
 * reads as an empty register rather than as a filter that did not apply.
 *
 * No existing field name contains a dot, so every caller is unaffected.
 */
export function searchFilter(search, fields) {
  if (!search) return undefined;
  return {
    OR: fields.map((field) => {
      const match = { contains: search, mode: 'insensitive' };
      // Build the nest from the inside out: 'a.b.c' -> { a: { b: { c: match } } }
      return field
        .split('.')
        .reverse()
        .reduce((inner, segment) => ({ [segment]: inner }), match);
    }),
  };
}
